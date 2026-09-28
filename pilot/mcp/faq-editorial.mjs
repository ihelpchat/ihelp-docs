import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { redactSensitiveData, containsSensitiveData } from './sensitive-data.mjs';
import { valueFor } from './api-synthetic-example.mjs';
import { FAQ_NEUTRAL_WORDS } from './faq-neutral-words.mjs';

export const FAQ_SECTIONS = {
  resposta: 'Resposta direta', paraQueServe: 'Para que serve', quandoUsar: 'Quando usar',
  passos: 'Passo a passo', exemplo: 'Exemplo', duvidas: 'Dúvidas comuns',
  erros: 'Erros comuns e o que fazer', suporte: 'Quando falar com o suporte',
};
const CORE = new Set(['resposta', 'passos']);
const BUSINESS_PATH = /^business-context\/[a-z0-9][a-z0-9-]*\.md$/u;
const normalized = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const literal = (quote, source) => normalized(quote).length >= 12
  && normalized(source).toLocaleLowerCase('pt-BR').includes(normalized(quote).toLocaleLowerCase('pt-BR'));
const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR');
const words = (value) => fold(value).match(/[a-z]+|\d+/gu) ?? [];
const hasLabel = (text, label) => {
  const inText = words(text), fromLabel = words(label);
  return fromLabel.length > 0 && inText.some((word, index) => word === fromLabel[0]
    && fromLabel.every((part, offset) => inText[index + offset] === part));
};
const singular = (word) => word.endsWith('oes') || word.endsWith('aes') ? `${word.slice(0, -3)}ao`
  : word.endsWith('ais') ? `${word.slice(0, -3)}al`
    : word.endsWith('eis') ? `${word.slice(0, -3)}el`
      : word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
const neutral = new Set(FAQ_NEUTRAL_WORDS.map((word) => singular(fold(word))));
const contentWords = (value) => words(value).filter((word) => word.length > 2 && !neutral.has(singular(word)));
const PROMISES = ['aumenta', 'reduz', 'garante', 'dobra', 'sempre', 'nunca', 'melhor', 'economiza'];
const numbers = (value) => String(value ?? '').match(/(?:R\$|US\$|€|\$)?\s*\d+(?:[.,]\d+)*(?:\s*%|\s*(?:dias?|horas?|minutos?|meses?|anos?))?/giu) ?? [];
const properNames = (value) => [...String(value ?? '').matchAll(/\p{L}+/gu)]
  .filter((match) => /\p{Ll}\p{Lu}/u.test(match[0]) || (match.index !== 0 && /^\p{Lu}/u.test(match[0])))
  .map((match) => fold(match[0]));

const syntheticEvidence = ['nome', 'email', 'telefone', 'id', 'numero', 'data', 'searchData']
  .map((name) => valueFor({ name })).join(' ');

// Ponto único para um verificador semântico futuro; hoje a decisão é extrativa.
function supportedClaim(text, sources, { example = false } = {}) {
  const evidence = [...sources, ...(example ? [syntheticEvidence] : [])].join(' ');
  const cited = new Set(words(evidence).map(singular));
  const uncovered = [...new Set(contentWords(text).filter((word) => !cited.has(singular(word))))];
  // Números, nomes e promessas obedecem à mesma cobertura total, inclusive nas seções centrais.
  if (numbers(text).some((number) => ![...sources, ...(example ? [syntheticEvidence] : [])]
    .some((source) => fold(source).includes(fold(number).trim())))) {
    for (const number of numbers(text)) if (!uncovered.includes(fold(number).trim())) uncovered.push(fold(number).trim());
  }
  if (properNames(text).some((name) => !fold(evidence).includes(name))) {
    for (const name of properNames(text)) if (!fold(evidence).includes(name) && !uncovered.includes(name)) uncovered.push(name);
  }
  if (PROMISES.some((word) => words(text).includes(word) && !words(evidence).includes(word))) {
    for (const word of PROMISES) if (words(text).includes(word) && !words(evidence).includes(word) && !uncovered.includes(word)) uncovered.push(word);
  }
  return uncovered;
}

export function classifyFaqQuestions(questions = []) {
  const blocking = [], pending = [];
  for (const question of questions) {
    const q = String(question);
    (/\b(?:como (?:entrar|abrir|acessar|começar|iniciar|salvar|confirmar|cadastrar|criar)|onde (?:fica|está|clicar)|qual (?:tela|botão|menu)|resposta direta|passo (?:principal|inicial))\b/iu.test(q)
      ? blocking : pending).push(q);
  }
  return { blocking, pending };
}

export async function loadBusinessContext(pilotRoot) {
  const directory = join(pilotRoot, 'architecture', 'business-context');
  if (!(await lstat(directory).catch(() => null))?.isDirectory()) return [];
  const names = await readdir(directory).catch(() => []);
  const result = [];
  for (const name of names.sort()) {
    const path = `business-context/${name}`;
    if (!BUSINESS_PATH.test(path)) continue;
    const absolute = join(directory, name);
    if (!(await lstat(absolute)).isFile()) continue;
    const body = await readFile(absolute, 'utf8');
    if (!/^🟢\s*PÚBLICO\b/mu.test(body) || /🟡|🔴|\b(?:INTERNO|CONFIDENCIAL)\b/iu.test(body)
      || containsSensitiveData(body, { detectOpaque: true })) continue;
    result.push({ path, body: redactSensitiveData(body) });
  }
  return result;
}

export async function selectFaqStyleExamples(docsRoot) {
  const names = (await readdir(docsRoot, { recursive: true }).catch(() => []))
    .filter((name) => name.endsWith('.mdx')).sort();
  const examples = [];
  for (const name of names) {
    const raw = await readFile(join(docsRoot, name), 'utf8');
    const front = raw.match(/^---\n([\s\S]*?)\n---/u);
    if (!front) continue;
    let fields;
    try { fields = parse(front[1]); } catch { continue; }
    if (fields?.contentType !== 'faq' || !['produto', 'suporte'].includes(fields.source)) continue;
    const body = raw.slice(front[0].length).replace(/```[\s\S]*?```/gu, '').replace(/<[^>]+>/gu, '');
    const sections = [...body.matchAll(/^##\s+(.+)$/gmu)].map((item) => item[1]);
    const steps = [...body.matchAll(/^\s*\d+[.)]\s+/gmu)].length;
    const examplesCount = [...body.matchAll(/\bexemplos?\b/giu)].length;
    const prose = body.split('\n').map((line) => line.trim()).filter(Boolean);
    const direct = prose.find((line) => !/^#|^\d+[.)]\s/u.test(line)) ?? '';
    const stepText = prose.filter((line) => /^\d+[.)]\s/u.test(line)).slice(0, 3);
    const example = prose.find((line) => /\bexemplo\b/iu.test(line)) ?? '';
    examples.push({ path: `docs/${name.replace(/\.mdx$/u, '')}`, sections: sections.length,
      steps, examples: examplesCount,
      style: redactSensitiveData(`Resposta: ${direct}\nPassos: ${stepText.join(' | ')}\nExemplo: ${example}`.slice(0, 900)) });
  }
  return examples.sort((a, b) => b.sections - a.sections || b.examples - a.examples
    || b.steps - a.steps || a.path.localeCompare(b.path)).slice(0, 3);
}

// M5.58 owns extraction. This adapter accepts only its public fact shape.
export function adaptScreenFacts(screen = {}) {
  return (screen.facts ?? []).flatMap((fact) => {
    const match = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.source ?? '');
    if (!match || !['route', 'action', 'field', 'column', 'upload', 'uploadLimit',
      'validation', 'message', 'destination', 'guard', 'text', 'state'].includes(fact.kind)) return [];
    const base = { ...fact, repository: fact.repository ?? 'ihelpchat/front-react',
      path: match[1], lineStart: Number(match[2]), lineEnd: Number(match[2]), sha: fact.sha ?? screen.sha };
    const qualifier = fact.required === true ? 'obrigatório' : fact.required === false ? 'opcional' : null;
    const presence = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? fact.source ?? '');
    if (['field', 'column'].includes(fact.kind) && fact.text)
      base.claimText = qualifier && fact.validationSource === undefined ? `${fact.text} ${qualifier}` : fact.text;
    const message = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? fact.source ?? '');
    return [base, ...(qualifier && fact.kind === 'field' && fact.validationSource && presence ? [{ ...base,
      claimText: `${fact.text} ${qualifier}${fact.message ? ` ${fact.message}` : ''}`,
      path: presence[1], lineStart: Number(presence[2]), lineEnd: Number(presence[2]) }] : []),
    ...(fact.kind === 'field' && fact.message && message ? [{ ...base, kind: 'message',
      text: fact.message, claimText: fact.message, path: message[1], lineStart: Number(message[2]), lineEnd: Number(message[2]) }] : [])];
  });
}

export function validateFaqSections(sections, context) {
  const kept = {}, pending = [];
  for (const key of Object.keys(FAQ_SECTIONS)) {
    const units = sections?.[key] ?? [];
    if (!Array.isArray(units) || !units.length) { pending.push(`seção sem fonte: ${FAQ_SECTIONS[key]}`); continue; }
    const valid = units.filter((unit) => {
      if (!unit || typeof unit.text !== 'string' || !normalized(unit.text)
        || !Array.isArray(unit.citations) || !unit.citations.length) return false;
      if (key === 'exemplo' && !unit.text.includes(valueFor({ name: 'nome' }))) return false;
      if ((key === 'paraQueServe' || key === 'quandoUsar')
        && !unit.citations.some((cite) => ['negocio', 'pagina', 'pedido'].includes(cite.source))) return false;
      // M5.58 represents missing or conflicting presence evidence as unknown.
      // Neither a support quote nor a validation message may override that state.
      if ((context.screenFacts ?? []).some((fact) => ['field', 'column'].includes(fact.kind)
        && fact.text && hasLabel(unit.text, fact.text)
        && ((fact.required !== true && /\bobrigatóri[oa]s?\b/iu.test(unit.text))
          || (fact.required !== false && /\bopciona(?:l|is)\b/iu.test(unit.text))))) return false;
      const citationsValid = unit.citations.every((cite) => {
        if (key === 'duvidas' && cite.source !== 'suporte') return false;
        if ((key === 'passos' || key === 'erros') && cite.source) return false;
        if (cite.source === 'pedido') return literal(cite.quote, `${context.request?.description ?? ''}\n${context.request?.details ?? ''}`);
        if (cite.source === 'pagina') {
          const page = context.existing?.find((item) => item.path === cite.path);
          return Boolean(page && literal(cite.quote, `${page.title ?? ''}\n${page.description ?? ''}\n${page.body ?? ''}`));
        }
        if (cite.source === 'suporte') return (context.support?.categories ?? []).some((item) =>
          literal(cite.quote, `${item.category}\n${item.guidance}`))
          || (context.support?.rules ?? []).some((rule) => literal(cite.quote, rule));
        if (cite.source === 'negocio') return BUSINESS_PATH.test(cite.path ?? '')
          && (context.business ?? []).some((item) => item.path === cite.path && literal(cite.quote, item.body));
        return (context.screenFacts ?? []).some((fact) => cite.repository === fact.repository
          && cite.path === fact.path && cite.sha === fact.sha && cite.lineStart === fact.lineStart
          && cite.lineEnd === fact.lineEnd
          && (key !== 'erros' || ['validation', 'message'].includes(fact.kind))
          && (!['passos', 'erros'].includes(key) || (fact.text
            && unit.text.toLocaleLowerCase('pt-BR').includes(fact.text.toLocaleLowerCase('pt-BR')))));
      });
      if (!citationsValid) return false;
      const sources = unit.citations.map((cite) => {
        if (cite.source) return cite.quote;
        const fact = (context.screenFacts ?? []).find((fact) => cite.repository === fact.repository
          && cite.path === fact.path && cite.sha === fact.sha && cite.lineStart === fact.lineStart
          && cite.lineEnd === fact.lineEnd);
        return fact?.claimText ?? fact?.text ?? '';
      });
      const uncovered = supportedClaim(unit.text, sources, { example: key === 'exemplo' });
      if (!uncovered.length) return true;
      pending.push(`palavra sem fonte: ${uncovered.join(', ')} em ${unit.text}`);
      return false;
    });
    if (valid.length) kept[key] = valid;
    if (valid.length !== units.length || !valid.length) pending.push(`seção sem fonte válida: ${FAQ_SECTIONS[key]}`);
  }
  return { sections: kept, pending: [...new Set(pending)], blocking: [...CORE].filter((key) => !kept[key]) };
}

export function renderFaqSections(sections) {
  return Object.entries(FAQ_SECTIONS).flatMap(([key, title]) => {
    const units = sections[key];
    if (!units?.length) return [];
    if (key === 'resposta') return [units.map((unit) => unit.text.trim()).join(' ')];
    if (key === 'passos') return [`## ${title}\n\n${units.map((unit, index) => `${index + 1}. ${unit.text.trim()}`).join('\n')}`];
    return [`## ${title}\n\n${units.map((unit) => unit.text.trim()).join('\n\n')}`];
  }).join('\n\n');
}
