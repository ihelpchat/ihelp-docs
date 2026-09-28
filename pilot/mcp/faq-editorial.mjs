import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { redactSensitiveData, containsSensitiveData } from './sensitive-data.mjs';
import { valueFor } from './api-synthetic-example.mjs';

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

export function classifyFaqQuestions(questions = []) {
  const blocking = [], pending = [];
  for (const question of questions) {
    const q = String(question);
    (/\b(?:como (?:entrar|abrir|acessar|começar|iniciar|salvar|confirmar|cadastrar|criar)|onde (?:fica|está|clicar)|qual (?:tela|botão|menu)|resposta direta|passo (?:principal|inicial))\b/iu.test(q)
      ? blocking : pending).push(q);
  }
  return { blocking, pending };
}

export async function loadBusinessContext(architectureRoot) {
  const directory = join(architectureRoot, 'business-context');
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
    examples.push({ path: `docs/${name.replace(/\.mdx$/u, '')}`, sections: sections.length,
      steps, examples: examplesCount,
      style: redactSensitiveData(`Introdução: ${String(fields.description ?? '').slice(0, 240)}\nSeções: ${sections.join(' | ').slice(0, 600)}`) });
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
    const message = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? fact.source ?? '');
    return [base, ...(fact.kind === 'field' && fact.message && message ? [{ ...base, kind: 'message',
      text: fact.message, path: message[1], lineStart: Number(message[2]), lineEnd: Number(message[2]) }] : [])];
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
      return unit.citations.every((cite) => {
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
          && (!['passos', 'erros'].includes(key) || !fact.text
            || unit.text.toLocaleLowerCase('pt-BR').includes(fact.text.toLocaleLowerCase('pt-BR'))));
      });
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
