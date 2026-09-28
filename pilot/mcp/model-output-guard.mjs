import { sanitizeCodeForModel } from './code-hygiene.mjs';

const MARKER = '[trecho de código interno omitido]';
const PAGE_REASON = 'a página copia código interno do back';
const TOKEN = /[\p{L}_][\p{L}\p{N}_]*|\d+|==|!=|<=|>=|=>|&&|\|\||\?\?|[^\s]/gu;
const SQL = /\b(?:SELECT\b[\s\S]{0,1000}?\bFROM\b[^\n;]*|INSERT\s+INTO\b[^\n;]*|UPDATE\b[^\n;]{0,1000}?\bSET\b[^\n;]*|DELETE\s+FROM\b[^\n;]*)/giu;

const tokens = (value) => [...String(value).matchAll(TOKEN)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
const key = (items) => items.map((item) => item.text).join('\u0000');
const privateEvidence = (context) => [
  ...context?.callEvidence ?? [],
  ...context?.screenCode ?? [],
  ...context?.matches ?? [],
].filter((item) => typeof item.excerpt === 'string'
  && !/(?:^|\/)\w*Controller\.cs$/iu.test(item.path ?? '')
  && (context?.callEvidence?.includes(item) || context?.screenCode?.includes(item) || /\.cs$/iu.test(item.path ?? '')))
  .map((item) => sanitizeCodeForModel(item.excerpt).text);

function evidenceWindows(context) {
  const windows = new Set();
  for (const source of privateEvidence(context)) {
    const parts = tokens(source);
    for (let i = 0; i <= parts.length - 8; i++) windows.add(key(parts.slice(i, i + 8)));
  }
  return windows;
}

function spansIn(text, windows, publicRoutes) {
  const spans = [...text.matchAll(SQL)].map((match) => [match.index, match.index + match[0].length]);
  const routes = publicRoutes.flatMap((route) => {
    const found = [];
    let start = text.indexOf(route);
    while (start !== -1) { found.push([start, start + route.length]); start = text.indexOf(route, start + route.length); }
    return found;
  });
  const parts = tokens(text);
  for (let i = 0; i <= parts.length - 8; i++) {
    if (!windows.has(key(parts.slice(i, i + 8)))) continue;
    let end = i + 8;
    while (end < parts.length && windows.has(key(parts.slice(end - 7, end + 1)))) end++;
    const span = [parts[i].start, parts[end - 1].end];
    if (!routes.some(([start, stop]) => span[0] >= start && span[1] <= stop)) spans.push(span);
    i = end - 1;
  }
  return spans.sort((a, b) => a[0] - b[0]).reduce((merged, span) => {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
    return merged;
  }, []);
}

export function guardModelOutput(value, context, mode = 'internal') {
  const windows = evidenceWindows(context);
  const publicRoutes = (context?.endpoints ?? []).filter((endpoint) => endpoint.public)
    .map((endpoint) => endpoint.route).filter((route) => typeof route === 'string' && route.startsWith('/'));
  let internalCodeEcho = 0;
  let pageEcho = false;
  const visit = (node, inPage = false) => {
    if (typeof node === 'string') {
      const spans = spansIn(node, windows, publicRoutes);
      internalCodeEcho += spans.length;
      if (inPage && spans.length) pageEcho = true;
      let redacted = node;
      for (const [start, end] of spans.reverse()) redacted = `${redacted.slice(0, start)}${MARKER}${redacted.slice(end)}`;
      return redacted;
    }
    if (Array.isArray(node)) return node.map((item) => visit(item, inPage));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([field, item]) =>
      [field, visit(item, inPage || (mode !== 'internal' && (field === 'articles' || field === 'article')))]));
    return node;
  };
  const guarded = visit(value);
  if (pageEcho) return { value: { status: 'needs_information', summary: PAGE_REASON, questions: [PAGE_REASON],
    articles: [], ...(mode === 'guide' ? { article: null } : {}), internalCodeEcho }, internalCodeEcho };
  return { value: { ...guarded, ...(internalCodeEcho ? { internalCodeEcho } : {}) }, internalCodeEcho };
}
