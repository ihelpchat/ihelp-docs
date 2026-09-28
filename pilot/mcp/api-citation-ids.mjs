import { sanitizeCodeForModel } from './code-hygiene.mjs';

const sourceAt = (source, endpoint) => {
  if (typeof source !== 'string' || !/^[a-f0-9]{40}$/u.test(endpoint.sha ?? '')) return null;
  const colon = source.lastIndexOf(':');
  const line = Number(source.slice(colon + 1));
  if (colon < 1 || !Number.isSafeInteger(line) || line < 1) return null;
  return { repository: endpoint.repository ?? 'ihelpchat/olah-ihelp', path: source.slice(0, colon),
    lineStart: line, lineEnd: line, sha: endpoint.sha };
};

export function apiCitationRegistry(context) {
  const registry = new Map();
  const counters = { C: 0, R: 0, P: 0, F: 0, N: 0 };
  const add = (prefix, entry) => registry.set(`${prefix}${++counters[prefix]}`, entry);
  const code = (item, start, end, excerpt) => {
    if (!item.repository || !item.path || !/^[a-f0-9]{40}$/u.test(item.sha ?? '')
      || item.ref !== item.sha || !Number.isSafeInteger(start) || start < 1 || end < start) return;
    add('C', { kind: 'code', text: excerpt,
      citation: { repository: item.repository, path: item.path, sha: item.sha, lineStart: start, lineEnd: end } });
  };
  for (const item of context.matches ?? []) {
    const numbers = [...String(item.excerpt ?? '').matchAll(/(?:^|\n)(\d+):/gu)].map((match) => Number(match[1]));
    const start = numbers[0] ?? item.line;
    const end = Math.min(numbers.at(-1) ?? item.line, start + 29);
    code(item, start, end, item.excerpt);
  }
  for (const item of context.callEvidence ?? []) {
    const lines = String(item.excerpt ?? '').split('\n');
    for (let offset = 0; offset < lines.length; offset += 30) {
      const chunk = lines.slice(offset, offset + 30);
      code(item, item.start + offset, Math.min(item.end, item.start + offset + chunk.length - 1), chunk.join('\n'));
    }
  }
  const sentenceParts = (value) => String(value ?? '').split(/(?<=[.!?;])\s+|\n/u).map((part) => part.trim()).filter(Boolean);
  for (const quote of sentenceParts(context.request?.description).concat(sentenceParts(context.request?.details)))
    add('R', { kind: 'request', text: quote, citation: { source: 'pedido', quote } });
  for (const page of [...context.existing ?? [], ...context.apiExamples ?? []]) {
    for (const quote of sentenceParts([page.title, page.description, page.body, page.content].filter(Boolean).join('\n')))
      if (quote.length >= 12) add('P', { kind: 'page', text: quote,
        citation: { source: 'pagina', path: page.path, quote } });
  }
  for (const item of context.businessContext ?? []) {
    for (const quote of sentenceParts(item.body))
      if (quote.length >= 12 && !quote.startsWith('#')) add('N', { kind: 'business', text: quote,
        citation: { source: 'negocio', quote } });
  }
  const covers = (citation) => [...registry.values()].some((item) => item.kind === 'code'
    && item.citation.repository === citation.repository && item.citation.path === citation.path
    && item.citation.sha === citation.sha && item.citation.lineStart <= citation.lineStart
    && item.citation.lineEnd >= citation.lineEnd);
  for (const endpoint of context.endpoints ?? []) {
    const facts = [
      ['método', endpoint.verb, endpoint.verbSource], ['rota', endpoint.route, endpoint.routeSource],
      ['autorização', endpoint.authorization ?? endpoint.policy, endpoint.authorizationSource],
      ...(endpoint.parameters ?? []).map((item) => ['parâmetro', item.name, item.source]),
      ...(endpoint.responseFields ?? []).map((item) => ['campo de resposta', item.name, item.source]),
      ...(endpoint.responseHeaders ?? []).map((item) => ['cabeçalho de resposta', item.name, item.source]),
    ];
    for (const [kind, value, source] of facts) {
      const citation = sourceAt(source, endpoint);
      if (value && citation && covers(citation)) add('F', { kind: 'fact', text: `${kind}: ${value}`, citation });
    }
  }
  return registry;
}

export function resolveApiCitationIds(ids, registry, claim = '') {
  const citations = [], issues = [];
  for (const id of ids ?? []) {
    if (typeof id === 'string') {
      const entry = registry.get(id);
      if (!entry) { issues.push(`identificador de citação inexistente: ${id}`); continue; }
      citations.push({ ...entry.citation, citationId: id });
    } else citations.push(id); // Older saved packages still carry complete citations.
  }
  if (claim && ids?.length && ids.every((id) => typeof id === 'string' && id.startsWith('R'))) {
    const source = ids.map((id) => registry.get(id)?.text ?? '').join(' ').toLocaleLowerCase('pt-BR');
    for (const [token] of claim.matchAll(/`([^`]+)`|\b([A-Za-z][\w]*[A-Z][\w]*|[A-Za-z][\w]*_[\w]+)\b|\b(\d+)\b/gu)) {
      const plain = token.replace(/`/gu, '').toLocaleLowerCase('pt-BR');
      if (!source.includes(plain)) issues.push(`fato técnico sem sustentação no pedido: ${plain}`);
    }
  }
  return { citations, issues };
}

export function apiCitationPrompt(registry) {
  return [...registry].map(([id, entry]) => `${id} [${entry.kind}] ${entry.kind === 'code'
    ? sanitizeCodeForModel(entry.text).text : entry.text}`).join('\n');
}
