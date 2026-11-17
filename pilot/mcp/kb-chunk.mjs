import { createHash } from 'node:crypto';

// Base de conhecimento: contrato KnowledgeChunk e corte de páginas em trechos.
// Funções puras; quem lê disco e chama provedor é kb-build.mjs.

export const SOURCES = ['faq', 'api', 'blog', 'tela', 'codigo', 'negocio', 'suporte', 'conversa', 'jornada', 'autor'];
const PUBLIC_SOURCES = new Set(['faq', 'api', 'blog']);

// Conteúdo publicado: referência da API e blog ficam separados do FAQ para não poluir a busca de ajuda.
export const publishedSource = (path) => {
  const top = String(path).replace(/^\//, '').split('/')[0];
  return top === 'api' ? 'api' : top === 'blog' ? 'blog' : 'faq';
};
const MAX_TEXT = 1_200;

export const normalizeText = (text) => String(text ?? '').toLocaleLowerCase('pt-BR').normalize('NFD')
  .replace(/\p{Diacritic}/gu, '');

export function chunkId(source, ref, text) {
  return createHash('sha256').update(JSON.stringify([source, ref, text])).digest('hex').slice(0, 24);
}

export function makeChunk({ source, module = null, title, text, ref = {}, updatedAt }) {
  if (!SOURCES.includes(source)) throw new Error(`source inválido: ${source}`);
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const body = clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}…` : clean;
  return {
    id: chunkId(source, ref, body), source,
    visibility: PUBLIC_SOURCES.has(source) ? 'publica' : 'interna',
    module, title: String(title ?? '').trim(), text: body, ref,
    updatedAt: updatedAt ?? new Date(0).toISOString(),
  };
}

// MDX → texto legível: tira imports, componentes JSX, imagens e marcação, mantém o que o leitor lê.
export function plainFromMdx(body) {
  return String(body ?? '')
    .replace(/^(import|export)\s.+$/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/[*_`>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const slugAnchor = (heading) => normalizeText(heading).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Parte o corpo em seções por heading ## (### fica dentro da seção de cima).
export function splitSections(body) {
  const sections = [{ heading: null, lines: [] }];
  let fenced = false;
  for (const line of String(body ?? '').split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced;
    const match = !fenced && /^##\s+(.+?)\s*$/.exec(line);
    if (match) sections.push({ heading: match[1].replace(/[*_`]/g, '').trim(), lines: [] });
    else sections.at(-1).lines.push(line);
  }
  return sections.map(({ heading, lines }) => ({ heading, body: lines.join('\n') }));
}

// Texto longo vira vários trechos, cortando em fim de frase quando dá.
export function splitLong(text, max = MAX_TEXT) {
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    const at = cut > max * 0.5 ? cut + 1 : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// Uma página publicada → trechos 'faq' (ou 'api'/'blog', pelo caminho). O título e a descrição entram em todo trecho como contexto.
export function chunkArticle({ path, title, description = '', body, module = null, sha, updatedAt, source }) {
  const chunks = [];
  const cleanPath = String(path).replace(/^\//, '');
  for (const section of splitSections(body)) {
    const text = plainFromMdx(section.body);
    if (!text && !section.heading) continue;
    const sectionTitle = section.heading ? `${title} › ${section.heading}` : title;
    const lead = section.heading ? '' : `${description} `.trimStart();
    for (const part of splitLong(`${lead}${text}`.trim() || sectionTitle)) {
      const chunk = makeChunk({ source: source ?? publishedSource(cleanPath), module, title: sectionTitle, text: part, updatedAt,
        ref: { path: cleanPath, ...(section.heading ? { anchor: `#${slugAnchor(section.heading)}` } : {}), ...(sha ? { sha } : {}) } });
      if (chunk) chunks.push(chunk);
    }
  }
  return chunks;
}

export const moduleSlug = (name) => normalizeText(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// coverage-matrix → mapa caminho publicado → módulo. Página filha herda o módulo da página listada.
export function moduleResolver(coverage = []) {
  const entries = coverage.flatMap(({ module, docs = [] }) => docs.map((doc) => [String(doc).replace(/^\//, ''), moduleSlug(module)]))
    .sort((left, right) => right[0].length - left[0].length);
  return (path) => {
    const clean = String(path).replace(/^\//, '');
    return entries.find(([doc]) => clean === doc || clean.startsWith(`${doc}/`))?.[1] ?? null;
  };
}

// Sinais de suporte agregados → trechos internos (o que os clientes mais perguntam e como orientar).
export function supportChunks(signals = {}) {
  const chunks = [];
  for (const item of signals.categories ?? []) {
    chunks.push(makeChunk({ source: 'suporte', title: `Motivo de suporte: ${item.category}`,
      text: `${item.guidance} (${item.conversations} conversas no período; autoatendimento: ${item.selfService}).`,
      ref: { path: 'architecture/support-signals.json', anchor: `#${slugAnchor(item.category)}` } }));
  }
  (signals.rules ?? []).forEach((rule, index) => chunks.push(makeChunk({ source: 'suporte', title: 'Regra editorial do suporte',
    text: rule, ref: { path: 'architecture/support-signals.json', anchor: `#regra-${index + 1}` } })));
  return chunks.filter(Boolean);
}

// Contexto de negócio 🟢 (saída de loadBusinessContext) → trechos internos por seção.
export function businessChunks(files = []) {
  return files.flatMap(({ path, body }) => {
    const name = path.split('/').pop().replace(/\.md$/, '');
    const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? name;
    return chunkArticle({ path, title, body: body.replace(/^#\s+.+$/m, ''), source: 'negocio', module: name === 'geral' ? null : name });
  });
}
