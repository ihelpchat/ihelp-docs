import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateCanonicalGuide } from '../lib/canonical-guides.mjs';
import { validatePublicArtifact } from '../lib/guide-package.mjs';
import approvedMap from '../product-map/approved.json' with { type: 'json' };
import { sensitiveKinds } from './sensitive-data.mjs';
import { securityReview } from './security-review.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { routeMatches } from './api-route-match.mjs';
import { contentRoutes, internalLinkIssues, parseArticle, parseMdx, plainText, publishedContent, visit } from './editorial-standard.mjs';
import publishedBaseline from './public-submit-baseline.json' with { type: 'json' };

// A mesma lista protege texto submetido ao MCP e passos dos guias submetidos.
export const jargon = Object.freeze(['template', 'API', 'Meta', 'Gupshup', 'janela de 24h', 'US$']);
const allowedHosts = new Set(['app.tango.us', 'apiv3.ihelpchat.com', 'ihelpchat.com.br', 'www.ihelpchat.com.br']);
const normalizeLabel = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
const mapLabels = new Set(approvedMap.manifest.labels.map(({ label }) => normalizeLabel(label)));
// CTA da Claricia é renderizado pelo widget público em pilot/lib/assistant.ts.
mapLabels.add(normalizeLabel('Falar com uma pessoa'));
const routes = new Set(approvedMap.manifest.routes.map(({ path }) => path));
// Radicais de ações e substantivos que identificam uma frase sobre a interface.
const UI_CUES = /\b(?:toc\w*|toq\w*|cliq\w*|cliqu\w*|apert\w*|pression\w*|selecion\w*|escolh\w*|desmarc\w*|marc\w*|acess\w*|desativ\w*|ativ\w*|preench\w*|digit\w*|entr\w*|arrast\w*|desliz\w*|abr\w*|v[aá]\s+(?:at[eé]|em|para)|bot[aã]o|aba|menu|opç[aã]o|campo|tela|[ií]cone|link|chave|caixa)\b/iu;
const PHRASING = new Set(['text', 'strong', 'emphasis', 'delete', 'inlineCode', 'break', 'link', 'linkReference', 'image', 'imageReference', 'footnoteReference', 'mdxJsxTextElement', 'mdxTextExpression', 'html']);

function checkLabelBlock(node, path) {
  let text = '';
  const labels = [];
  for (const child of node.children ?? []) {
    visit(child, (descendant) => {
      const start = text.length;
      if (descendant.type === 'strong' || (descendant.type === 'inlineCode' && !path.startsWith('api/')))
        labels.push({ value: plainText(descendant), start });
      if (descendant.type === 'text') for (const match of descendant.value.matchAll(/["“”]([^"“”]+)["“”]/gu))
        labels.push({ value: match[1], start: start + match.index });
      if (descendant.type === 'text' || descendant.type === 'inlineCode') text += descendant.value;
    });
  }
  for (const label of labels) {
    const before = text.slice(0, label.start);
    const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?')) + 1;
    const after = text.slice(label.start);
    const end = after.search(/[.!?](?:\s|$)/u);
    const sentence = text.slice(sentenceStart, end < 0 ? undefined : label.start + end + 1);
    if (UI_CUES.test(sentence) && !mapLabels.has(normalizeLabel(label.value))) reject(`rótulo fora do mapa: ${label.value}`);
  }
}

function checkInterfaceLabels(body, path) {
  visit(parseMdx(body), (node) => {
    if (!PHRASING.has(node.type) && node.children?.some((child) => PHRASING.has(child.type))) checkLabelBlock(node, path);
    if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
    for (const attr of node.attributes ?? []) {
      if (typeof attr.value === 'string') checkLabelBlock({ children: [{ type: 'text', value: attr.value }] }, path);
    }
  });
}

function reject(message) { throw Object.assign(new Error(`gate público: ${message}`), { code: 'PUBLIC_GATE' }); }

async function securityFacts(root, article) {
  const route = String(article.endpoint ?? '');
  const verb = String(article.method ?? '').toUpperCase();
  const context = await getIhelpContext(root, `${verb} ${route}`, 'api', {
    requireLocal: true, repositoryIds: ['backend'], explicitEndpoints: [{ verb, route }],
  }).catch(() => null);
  const endpoint = context?.endpoints?.find((item) => item.verb === verb &&
    [item.route, ...(item.optionalAliases ?? [])].some((candidate) =>
      routeMatches(route, candidate) || routeMatches(route, candidate.replace(/^\/api\/v\d+/iu, ''))));
  return endpoint ?? null;
}

const API_HOSTS = new Set(['apiv3.ihelpchat.com']);
const HTTP_METHOD = '(?:GET|POST|PUT|PATCH|DELETE)';

function citedMethod(line, before, after) {
  const explicit = before.match(new RegExp(`\\b(${HTTP_METHOD})\\s+$`, 'iu'));
  if (explicit) return explicit[1].toUpperCase();
  const command = line.match(/\bcurl\b[^\n]*/iu)?.[0];
  const context = command ?? line;
  const option = context.match(new RegExp(`(?:-X|--request)\\s+['"]?(${HTTP_METHOD})\\b`, 'iu'));
  if (option) return option[1].toUpperCase();
  const property = context.match(new RegExp(`(?:["']?method["']?)\\s*:\\s*['"]?(${HTTP_METHOD})\\b`, 'iu'));
  if (property) return property[1].toUpperCase();
  const leading = before.match(new RegExp(`\\b(${HTTP_METHOD})\\s+[^\\n]*$`, 'iu'));
  if (leading) return leading[1].toUpperCase();
  if (command) return /(?:^|\s)(?:-d|--data(?:-[\w-]+)?|-F)(?=\s|=|$)/iu.test(command) ? 'POST' : 'GET';
  // Uma propriedade de fetch pode vir depois da URL no mesmo comando.
  const following = after.match(new RegExp(`(?:["']?method["']?)\\s*:\\s*['"]?(${HTTP_METHOD})\\b`, 'iu'));
  if (following) return following[1].toUpperCase();
  const client = before.match(/\b(?:fetch|requests\.(get|post|put|patch|delete))\s*\([^\n]*$/iu);
  if (client) return client[1]?.toUpperCase() ?? 'GET';
  return undefined;
}

export function extractCitedEndpoints(article) {
  const primary = { method: String(article.method ?? '').toUpperCase(), endpoint: String(article.endpoint ?? '') };
  const endpoints = [primary];
  const unresolved = [];
  const body = String(article.body ?? '').replace(/\\\r?\n\s*/gu, ' ')
    .replace(/\b(?:fetch|requests\.(?:get|post|put|patch|delete))\s*\([\s\S]*?\)/giu,
      (call) => call.replace(/\r?\n\s*/gu, ' '));
  let fenced = false;
  for (const line of body.split(/\r?\n/u)) {
    const fence = /^\s*```/u.test(line);
    if (fence) { fenced = !fenced; continue; }
    const matches = [];
    for (const match of line.matchAll(/https?:\/\/[^\s`<>"')]+/giu)) {
      let url;
      try { url = new URL(match[0].replace(/[.,;:!?]+$/u, '')); } catch { continue; }
      if (API_HOSTS.has(url.hostname)) matches.push({ index: match.index, length: match[0].length, route: url.pathname });
    }
    for (const match of line.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_{}./?=&%-]+)/giu))
      matches.push({ index: match.index + match[0].indexOf(match[2]), length: match[2].length, route: match[2], method: match[1].toUpperCase() });
    const codeRanges = fenced ? [[0, line.length]] : [...line.matchAll(/`[^`\n]+`/gu)].map((match) => [match.index, match.index + match[0].length]);
    for (const [start, end] of codeRanges) {
      const code = line.slice(start, end);
      for (const match of code.matchAll(/(?<![A-Za-z0-9/:])\/[A-Za-z0-9_{}.-]+(?:\/[A-Za-z0-9_{}.-]+)+(?:\?[^\s`"']+)?/gu)) {
        const index = start + match.index;
        if (!matches.some((item) => index >= item.index && index < item.index + item.length))
          matches.push({ index, length: match[0].length, route: match[0] });
      }
    }
    for (const candidate of matches.sort((a, b) => a.index - b.index)) {
      const endpoint = candidate.route.replace(/[.,;:!?]+$/u, '').split(/[?#]/u)[0];
      const method = candidate.method ?? citedMethod(line, line.slice(0, candidate.index), line.slice(candidate.index + candidate.length));
      if (!method) { if (!unresolved.includes(endpoint)) unresolved.push(endpoint); continue; }
      const base = primary.endpoint.replace(/^\/api\/v\d+/iu, '');
      const short = endpoint.replace(/^\/api\/v\d+/iu, '');
      if (method === primary.method && (routeMatches(short, base) || short.startsWith(`${base}/id-exemplo-`))) continue;
      if (!endpoints.some((item) => item.method === method && routeMatches(endpoint, item.endpoint)))
        endpoints.push({ method, endpoint });
    }
  }
  return { endpoints, unresolved };
}

// Único preflight de segurança para páginas propostas ou gravadas pelo MCP.
export async function reviewBeforePageWrite(root, items, request = {}) {
  const warnings = [];
  const required = new Set();
  const missing = [];
  for (const { article } of items) {
    const api = article.path.startsWith('api/');
    const cited = api ? extractCitedEndpoints(article) : { endpoints: [{}], unresolved: [] };
    missing.push(...cited.unresolved.map((endpoint) => `endpoint citado sem método: ${endpoint}`));
    for (const endpoint of cited.endpoints) {
      const candidate = api ? { ...article, ...endpoint } : article;
      const facts = api ? await securityFacts(root, candidate) : {};
      if (api && !facts) {
        missing.push(`sem fatos do código para conferir os campos do endpoint ${endpoint.method} ${endpoint.endpoint}`);
      }
      const review = securityReview(candidate, { facts: facts ?? {}, request });
      if (review.blocks.length) reject(review.blocks[0]);
      warnings.push(...review.warnings);
      if (review.warnings.length) required.add(review.endpoint);
    }
  }
  if (request.confirmations !== undefined && (!Array.isArray(request.confirmations)
    || request.confirmations.some((item) => typeof item !== 'string')))
    reject('confirmations deve ser uma lista de endpoints sensíveis');
  const given = request.confirmations ?? [];
  for (const item of given) if (!required.has(item)) reject(`confirmação ${item} não corresponde a endpoint sensível do pacote`);
  const questions = [...missing, ...[...required].filter((item) => !given.includes(item))
    .map((item) => `Para seguir, confirme o endpoint sensível: ${item}`)];
  return { ...(questions.length ? { status: 'needs_information', questions } : {}), securityWarnings: [...new Set(warnings)] };
}

function checkJargon(text) {
  for (const term of jargon) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^\\p{L}])${escaped}(?=$|[^\\p{L}])`, 'giu');
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[1].length;
      const sentence = text.slice(Math.max(0, text.lastIndexOf('.', start - 1) + 1), text.indexOf('.', start) < 0 ? undefined : text.indexOf('.', start) + 1);
      if (!/(?:\([^)]{5,}\)|\bsignifica\b|\bquer dizer\b|\bé (?:um|uma|o|a)\b)/iu.test(sentence)) reject(`jargão sem explicação: ${term}`);
    }
  }
}

export async function assertPublicSubmit(root, items, deletes = [], { ignoreBaseline = false, request = {}, securityOnly = false } = {}) {
  const security = await reviewBeforePageWrite(root, items, request);
  if (securityOnly || security.status === 'needs_information') return security;
  const published = await publishedContent(root);
  const after = new Map(published);
  for (const path of deletes) after.delete(path);
  for (const { article, rendered } of items) after.set(article.path, rendered);
  const routesAfter = contentRoutes(after.keys());
  for (const { article, rendered } of items) {
    if (!article.path.startsWith('api/')) {
      const kinds = sensitiveKinds(rendered);
      if (kinds.credential || kinds.personal || kinds.internal || kinds.control) reject('fonte interna ou dado privado');
    }
    if (/<(?:img|Image)\b/iu.test(article.body)) reject('print sem aprovação editorial');

    if (article.guide) {
      validatePublicArtifact(article.guide, article.path);
      validateCanonicalGuide(rendered, article.guide.guideId);
      const sources = [...rendered.matchAll(/\{\/\* fonte: ([a-z0-9-]+) \| (front|back)@([a-f0-9]{12}):([^\s|]+):(\d+) \| alvo: ([^\n]+) \*\/\}/gu)];
      if (sources.length !== article.guide.steps.length) reject('grounding incompleto');
      for (const [, , side, sha, file, , target] of sources) {
        if (sha !== (side === 'front' ? approvedMap.frontSha : approvedMap.backSha).slice(0, 12)) reject('fonte fora do mapa aprovado');
        if (!approvedMap.manifest.markers.some((entry) => target.includes(entry.id)) && !approvedMap.manifest.routes.some((entry) => target.includes(entry.path)) && !approvedMap.manifest.labels.some((entry) => target.includes(entry.label))) reject('alvo fora do mapa aprovado');
        if (!file.startsWith(side === 'front' ? 'src/' : 'Comzada.') && !file.startsWith('Controllers/')) reject('fonte fora do produto');
      }
    }

    if (article.path.startsWith('docs/') || article.path.startsWith('tutoriais/')) {
      checkJargon([article.title, article.description, article.body, ...(article.guide?.steps ?? []).map(({ text }) => text)].join('\n'));
    }
    const reviewNote = /\n\n\{\/\* Revisão editorial pendente: front [a-f0-9]{40}; back [a-f0-9]{40}; (?:atualizar|avisar) (?:route|marker|label|permission)(?:, (?:atualizar|avisar) (?:route|marker|label|permission))*\. \*\/\}(?=\n$)/u;
    const baselineText = rendered.replace(reviewNote, '');
    const prior = published.get(article.path);
    const reviewOnly = baselineText !== rendered && prior && JSON.stringify(parseArticle(prior, article.path)) === JSON.stringify(parseArticle(baselineText, article.path));
    const unchangedBaseline = !ignoreBaseline && (publishedBaseline[article.path] === createHash('sha256').update(baselineText).digest('hex') || reviewOnly);
    if (!unchangedBaseline) {
      for (const text of [article.title, article.description, article.body, ...(article.guide?.steps ?? []).map(({ text }) => text)]) checkInterfaceLabels(text, article.path);
    }
    const brokenLinks = await internalLinkIssues(root, article.path, article.body, routesAfter, after);
    if (brokenLinks.length) reject(brokenLinks[0]);
    for (const [raw] of article.body.matchAll(/https?:\/\/[^\s<)"']+/giu)) {
      let url;
      try { url = new URL(raw.replace(/[.,;:!?]+$/u, '')); } catch { reject('link inválido'); }
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password) reject('link externo proibido');
    }
    for (const match of article.body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
      const value = match[1];
      if (match[0].startsWith('!')) {
        if (!/^\/img\/help\/[A-Za-z0-9/_-]+\.(?:png|webp|jpg)$/u.test(value)) reject('print fora do catálogo público');
        try { await access(join(root, 'public', value.slice(1))); } catch { reject('print não aprovado'); }
        const published = await readFile(join(root, 'content/docs', `${article.path}.mdx`), 'utf8').catch(() => '');
        if (!published.includes(match[0])) reject('print sem aprovação editorial');
        continue;
      }
      if (value.startsWith('/')) {
        const pathname = value.split(/[?#]/u)[0];
        if (value.includes('?') || (!routes.has(pathname) && !/^\/(?:docs|api|blog|tutoriais)(?:\/|$)/u.test(pathname))) reject('link fora do catálogo público');
      } else if (value.startsWith('#') || value.startsWith('./') || value.startsWith('../') || /^[a-z0-9][a-z0-9/_-]*(?:[?#][^\s]*)?$/iu.test(value)) {
        // O validador editorial acima resolve estes links a partir da página.
      } else {
        let url;
        try { url = new URL(value); } catch { reject('link inválido'); }
        if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password) reject('link externo proibido');
      }
    }
  }
  for (const path of deletes) if (sensitiveKinds(path).internal) reject('fonte interna');
  const changedExisting = items.some(({ article, rendered }) => published.has(article.path) && published.get(article.path) !== rendered);
  if (deletes.length || changedExisting) {
    const routesBefore = contentRoutes(published.keys());
    const packagePaths = new Set([...items.map(({ article }) => article.path), ...deletes]);
    const incoming = [];
    for (const [path, raw] of published) {
      if (packagePaths.has(path)) continue;
      const before = new Set(await internalLinkIssues(root, path, raw, routesBefore, published));
      const issues = await internalLinkIssues(root, path, raw, routesAfter, after);
      for (const issue of issues) if (!before.has(issue)) incoming.push(`${path}: ${issue}`);
    }
    if (incoming.length) reject(`links de entrada quebrados: ${incoming.join('; ')}`);
  }
  const reviewRequired = items.some(({ article }) => Boolean(article.guide));
  return { ...(items.some(({ article }) => article.path.startsWith('api/')) ? { securityWarnings: security.securityWarnings } : {}),
    ...(reviewRequired ? { reviewRequired: true, proofStatus: 'manual_required' } : {}) };
}
