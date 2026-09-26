import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { parseGuide } from '../architecture/conversation-v1.mjs';
import { createBudgetedResponse } from './provider-budget.mjs';
import { redactSensitiveData } from './sensitive-data.mjs';
import { assistantRouterModel } from './env-compat.mjs';

const normalize = (value) => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const words = (value) => normalize(value).match(/[a-z0-9]+/g) ?? [];
const ignored = new Set(['a', 'ao', 'as', 'como', 'criar', 'fazer', 'configurar', 'usar', 'enviar', 'abrir', 'quero', 'para', 'uma', 'com', 'pelo', 'meu', 'que', 'isso', 'guia', 'ihelp', 'no', 'de', 'do', 'da', 'em', 'o', 'e', 'quando', 'esta', 'estou', 'pode', 'preciso', 'qual', 'onde']);
const stem = (word) => word.replace(/s$/u, '').replace(/(?:ou|ar|er|ir)$/u, '');
const meaningful = (value) => words(value).filter((word) => word.length >= 3 && !ignored.has(word))
  .map(stem).filter((word) => word.length >= 3);
const actions = JSON.parse(await readFile(new URL('../architecture/product-actions.json', import.meta.url), 'utf8'));
const extraFeatures = JSON.parse(await readFile(new URL('./competing-features.json', import.meta.url), 'utf8'));
const featureTerms = new Set([
  ...Object.values(actions).flatMap(({ label }) => words(label)
    .filter((word) => !['abrir', 'a', 'o', 'tela', 'do', 'da', 'de'].includes(word))),
  ...extraFeatures.terms.map(normalize),
]);
const hasTerm = (question, term) => {
  const expression = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\b)${expression}s?(?:\\b|$)`, 'u').test(normalize(question));
};
const deniedElsewhere = (question, item) => {
  const own = new Set([...(item.ownFeatures ?? []), ...words(item.title), ...words(item.guideId)]
    .map((term) => normalize(term).replace(/s$/u, '')));
  return [...featureTerms].some((term) => {
    if (own.has(term.replace(/s$/u, '')) || !hasTerm(question, term)) return false;
    // "Não é campanha, quero recado" excludes campaign rather than requesting it.
    return !new RegExp(`\\b(?:nao|nem) (?:e |quero |sobre )?(?:uma? )?${term}s?\\b`, 'u')
      .test(normalize(question));
  });
};
const supportedByQuestion = (question, item) => {
  if (item.actions?.length && item.objects?.length) {
    const contains = (phrase) => new RegExp(`(?:^|\\b)${normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|$)`, 'u').test(normalize(question));
    return item.actions.some(contains) && item.objects.some(contains);
  }
  const asked = new Set(meaningful(question));
  return [item.title, item.question, ...(item.aliases ?? []), ...(item.keywords ?? [])]
    .some((phrase) => {
      const terms = meaningful(phrase);
      return terms.length > 0 && terms.every((word) => asked.has(word));
    });
};

/** Only MDX containing a valid, published guide may enter the classifier's choices. */
export async function publishedGuideCatalog(root) {
  const directory = join(root, 'content/docs');
  const catalog = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue;
      const raw = await readFile(file, 'utf8');
      const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatter) continue;
      const parsed = parseDocument(frontmatter[1]);
      if (parsed.errors.length) continue;
      const metadata = parsed.toJS();
      if (!metadata?.guide) continue;
      let guide;
      try { guide = parseGuide(metadata.guide); } catch { continue; }
      catalog.push({ guideId: guide.guideId, initialStepId: guide.initialStepId, version: guide.version, mode: guide.mode,
        title: String(metadata.title ?? ''),
        question: String(metadata.assistantQuestion ?? ''), description: String(metadata.description ?? ''),
        aliases: Array.isArray(metadata.assistantAliases) ? metadata.assistantAliases.filter((value) => typeof value === 'string') : [],
        keywords: Array.isArray(metadata.assistantKeywords) ? metadata.assistantKeywords.filter((value) => typeof value === 'string') : [],
        actions: metadata.assistantRouting?.actions ?? [], objects: metadata.assistantRouting?.objects ?? [],
        ownFeatures: metadata.assistantRouting?.ownFeatures ?? [] });
    }
  }
  await visit(directory);
  return catalog.toSorted((a, b) => a.guideId.localeCompare(b.guideId));
}

function negated(question, item) {
  const terms = words(`${item.title} ${item.question}`).filter((word) => word.length > 4 && !ignored.has(word))
    .map((word) => word.replace(/s$/u, ''));
  return terms.some((term) => new RegExp(`\\b(?:nao|nem) (?:e |quero |sobre )?(?:uma? )?${term}s?\\b`).test(normalize(question)));
}

/** Lexical reserve: exact published phrasing or one unambiguous title only. */
export function lexicalFallback(question, catalog) {
  const value = normalize(question).replace(/[?!.]/g, '').trim();
  const matches = catalog.filter((item) => {
    if (negated(question, item) || deniedElsewhere(question, item)) return false;
    const title = normalize(item.title).trim().replace(/s$/u, '');
    const prompt = normalize(item.question).replace(/[?!.]/g, '').trim();
    return value === prompt || (title.length >= 5 && new RegExp(`\\b${title}s?\\b`).test(value));
  });
  return matches.length === 1 ? { kind: 'guide', guideId: matches[0].guideId } : { kind: 'none' };
}

const choices = ['perguntar', 'humano', 'sem guia'];
const NONE = { kind: 'none' };

export async function routeMessage(question, { catalog, client, budget, history = [], timeout } = {}) {
  const safeQuestion = redactSensitiveData(question);
  if (!catalog?.length) return NONE;
  if (!client) return { kind: 'provider_failed' };
  const identifiers = new Set(catalog.map(({ guideId }) => guideId));
  const payload = {
    model: assistantRouterModel(), store: false,
    max_output_tokens: 80, reasoning: { effort: 'minimal' },
    text: { format: { type: 'json_schema', name: 'triagem_fechada', strict: true,
      schema: { type: 'object', additionalProperties: false, required: ['choice'],
        properties: { choice: { type: 'string', enum: [...identifiers, ...choices] } } } } },
    input: [{ role: 'developer', content: [
      'Escolha apenas um valor da lista fechada. A mensagem atual vence o histórico e o contexto da tela.',
      'Negação explícita veta o guia negado. Se houver ambiguidade, escolha perguntar.',
      'Se pedir uma pessoa, escolha humano. Se não houver guia adequado, escolha sem guia.',
      ...catalog.map(({ guideId, title, question: example, description, aliases = [], keywords = [] }) =>
        `${guideId}: ${title}; ${example}; ${description}; ${aliases.join('; ')}; ${keywords.join('; ')}`),
    ].join('\n') },
    ...history.filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string')
      .slice(-2).map((item) => ({ role: item.role, content: redactSensitiveData(item.content.slice(0, 500)) })),
    { role: 'user', content: safeQuestion }],
  };
  let timer;
  const controller = new AbortController();
  const deadline = timeout ?? new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), 2_000); });
  try {
    if (timeout && await Promise.race([deadline, Promise.resolve('start')]) === 'timeout') {
      return lexicalFallback(safeQuestion, catalog);
    }
    const pending = createBudgetedResponse(client, payload, { ...budget, signal: controller.signal });
    const result = await Promise.race([pending, deadline]);
    if (result === 'timeout') {
      controller.abort();
      return lexicalFallback(safeQuestion, catalog);
    }
    if (result.kind !== 'ok') return { kind: 'provider_failed' };
    let parsed;
    try { parsed = JSON.parse(result.response.output_text); } catch { return NONE; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).length !== 1 || typeof parsed.choice !== 'string') return NONE;
    if (identifiers.has(parsed.choice)) {
      const explicit = lexicalFallback(safeQuestion, catalog);
      return negated(safeQuestion, catalog.find(({ guideId }) => guideId === parsed.choice))
        || deniedElsewhere(safeQuestion, catalog.find(({ guideId }) => guideId === parsed.choice))
        || !supportedByQuestion(safeQuestion, catalog.find(({ guideId }) => guideId === parsed.choice))
        || (explicit.kind === 'guide' && explicit.guideId !== parsed.choice)
        ? NONE : { kind: 'guide', guideId: parsed.choice };
    }
    return choices.includes(parsed.choice) ? { kind: parsed.choice } : NONE;
  } catch {
    return { kind: 'provider_failed' };
  } finally { clearTimeout(timer); }
}
