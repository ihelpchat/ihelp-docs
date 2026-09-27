import { readFile, readdir } from 'node:fs/promises';
import { STATUS_CODES } from 'node:http';
import { isIP } from 'node:net';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { sensitiveKinds } from './sensitive-data.mjs';
import { PRODUCT_TERMS } from './product-terms.mjs';
import { valueFor } from './api-reference-render.mjs';

const allowedHosts = new Set(['apiv3.ihelpchat.com', 'app.ihelpchat.com', 'app.tango.us', 'assets.ihelpchat.com',
  'images.ihelpchat.com', 'faq.ihelpchat.com', 'ihelpchat.com.br', 'www.ihelpchat.com.br']);
const publicTlds = new Set(['com', 'net', 'org', 'io', 'app', 'dev', 'br', 'cloud', 'co', 'ai', 'info', 'biz', 'me', 'us', 'tech']);
const internalSuffixes = new Set(['local', 'internal', 'lan', 'corp', 'intranet', 'localdomain']);
const hostReason = (type) => `URL ou host fora da API pública e do site do FAQ (${type}).`;
function hostBlocks(text) {
  const blocks = [];
  const domain = /(?<![\p{L}\p{N}_])([a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+)(?::\d{1,5})?(?![\p{L}\p{N}_])/giu;
  for (const match of text.matchAll(domain)) {
    const host = match[1].toLowerCase();
    const last = host.slice(host.lastIndexOf('.') + 1);
    const prefix = text.slice(Math.max(0, match.index - 3), match.index);
    if (/^(?:tsx?|jsx?|mjs|cjs|cs|mdx?|json|py|ya?ml|css|scss)$/u.test(last)
      && match[0].length > match[1].length && prefix.endsWith('/') && !prefix.endsWith('://')) continue; // arquivo:linha
    if (isIP(host)) blocks.push(hostReason('IP'));
    else if (internalSuffixes.has(last)) blocks.push(hostReason('interno'));
    else if (match[0].length > match[1].length) blocks.push(hostReason('porta'));
    else if (publicTlds.has(last) && !allowedHosts.has(host)) blocks.push(hostReason('domínio'));
  }
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_.-])localhost(?::\d{1,5})?(?![\p{L}\p{N}_.-])/giu))
    blocks.push(hostReason('interno'));
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_.-])[a-z][a-z\d-]*:\d{1,5}(?![\p{L}\p{N}_.-])/giu))
    blocks.push(hostReason('porta'));
  for (const match of text.matchAll(/(?<![\p{L}\p{N}_])\[?([\da-f:.]+)\]?(?::\d{1,5})?(?![\p{L}\p{N}_])/giu)) {
    if (match[1].includes(':') && isIP(match[1]) === 6) blocks.push(hostReason('IP'));
  }
  return unique(blocks);
}
const unique = (values) => [...new Set(values)];
export const finalizeSecurityResponse = (result, warnings = result.securityWarnings ?? []) =>
  ({ ...result, securityWarnings: unique(warnings) });
const endpointName = (article) => `${String(article.method ?? 'GET').toUpperCase()} ${article.endpoint ?? ''}`.trim();
const stringsOf = (value) => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(stringsOf)
    : value && typeof value === 'object' ? Object.values(value).flatMap(stringsOf) : [];
const normalizedIds = (text) => [...text.matchAll(/(?<![\da-f])[\da-f][\da-f_:\s-]{22,70}[\da-f](?![\da-f])/giu)]
  .some(([candidate]) => [24, 32].includes(candidate.replace(/[-_\s:]/gu, '').length)
    && /^[\da-f]+$/iu.test(candidate.replace(/[-_\s:]/gu, '')));

const PERSON_NAME = /\b\p{Lu}[\p{Ll}\p{M}]+(?:[ \t]+\p{Lu}[\p{Ll}\p{M}]+)+\b/gu;
const httpStatusPhrases = new Set(Object.values(STATUS_CODES).map((phrase) => phrase.toLocaleLowerCase('en-US')));
const permittedName = (name) => /\b(?:Exemplo|Teste)\b/iu.test(name)
  || httpStatusPhrases.has(name.toLocaleLowerCase('en-US'))
  || PRODUCT_TERMS.some((term) => term.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));

function exampleZones(text) {
  const zones = [];
  const prose = text.replace(/```[\s\S]*?```/gu, (block) => { zones.push(block); return '\n'; })
    .replace(/`[^`\n]+`/gu, (block) => { zones.push(block); return ''; });
  for (const paragraph of prose.split(/\n\s*\n/u)) {
    if (/^\s*(?:Exemplo\b|Ex\.:|Por exemplo\b)/iu.test(paragraph)) zones.push(paragraph);
    else for (const line of paragraph.split('\n')) {
      if (/^\s*(?:Exemplo\b|Ex\.:|Por exemplo\b)/iu.test(line)
        || /^\s*[{[]\s*["']|["']\w+["']\s*:/u.test(line)) zones.push(line);
    }
  }
  return zones;
}

function hasExamplePersonName(text) {
  return exampleZones(text).some((zone) => [...zone.matchAll(PERSON_NAME)]
    .some(([name]) => !permittedName(name)));
}

function pathExampleBlock(facts, examples) {
  const routes = [facts.route, ...(facts.optionalAliases ?? (facts.optionalAlias ? [facts.optionalAlias] : []))]
    .filter(Boolean).map((route) => route.replace(/^\/api\/v\d+/iu, ''));
  for (const { endpoint } of examples) {
    const sample = endpoint.replace(/^\/api\/v\d+/iu, '').split('/').filter(Boolean);
    const template = routes.find((route) => route.split('/').filter(Boolean).length === sample.length);
    if (!template) continue;
    const expected = template.split('/').filter(Boolean);
    for (const [index, segment] of expected.entries()) {
      const parameter = segment.match(/^\{([^}]+)\}$/u)?.[1];
      if (!parameter) {
        if (segment.toLowerCase() !== sample[index].toLowerCase())
          return `path de exemplo diverge do template em ${segment}`;
        continue;
      }
      const field = facts.parameters?.find((item) => item.name.toLowerCase() === parameter.toLowerCase())
        ?? { name: parameter, type: 'string' };
      if (!/^\{[^}]+\}$/u.test(sample[index]) && sample[index] !== valueFor(field))
        return `path de exemplo com valor real em ${parameter}; use o valor sintético`;
    }
  }
  return null;
}

export function securityReview(article, { facts = {}, request = {}, examples = [] } = {}) {
  const blocks = [];
  const warnings = [];
  const body = String(article.body ?? '');
  const text = stringsOf(article).join('\n');
  const kinds = sensitiveKinds(text);
  if (kinds.personal) blocks.push('Exemplo contém possível dado pessoal (telefone, e-mail ou CPF/CNPJ). Use apenas valores sintéticos.');
  if (kinds.credential || kinds.internal || kinds.control) blocks.push('Conteúdo contém possível segredo ou informação interna.');
  if (normalizedIds(text))
    blocks.push('Exemplo contém id real (ObjectId ou UUID). Use id-exemplo-1.');
  const pathBlock = pathExampleBlock(facts, examples);
  if (pathBlock) blocks.push(pathBlock);
  blocks.push(...hostBlocks(text));
  if (/\b(?:role|policy|papel|política)\s*(?:exigid[ao]|de autorização)?\s*[:=]\s*[A-Za-z][\w.-]+|\b(?:role|policy)\s+[A-Z][\w.-]+/iu.test(text))
    blocks.push('Detalhe de role ou policy de autorização: diga apenas “requer autenticação”.');
  if (article.path?.startsWith('api/')) for (const parameter of facts.parameters ?? []) {
    if (parameter.serverAssigned === true) blocks.push(`Parâmetro ${parameter.name} é preenchido pelo servidor (serverAssigned).`);
  }
  if (hasExamplePersonName(text))
    blocks.push('Exemplo contém nome de pessoa. Use “Pessoa Exemplo”.');

  const method = String(article.method ?? '').toUpperCase();
  const route = String(article.endpoint ?? '');
  if (article.path?.startsWith('api/')) {
    if (method === 'DELETE' || /(?:massdelete|mass|import|export|sync|delete|showall)/iu.test(route))
      warnings.push(`${endpointName(article)} pode apagar ou movimentar muitos dados. Confirme que deve ser documentado.`);
    if (/\bshowAll\b|\bexport\b/iu.test(text))
      warnings.push(`${endpointName(article)} pode devolver todos os dados sem paginação.`);
  }
  const confirmed = Array.isArray(request.confirmations) && request.confirmations.includes(endpointName(article));
  return { blocks: unique(blocks), warnings: unique(warnings), ...(warnings.length ? { confirmed, endpoint: endpointName(article) } : {}) };
}

export async function auditPages(root, { apiOnly = false } = {}) {
  const base = join(root, 'content/docs');
  const findings = [];
  const counts = { api: 0, nonApi: 0 };
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        const raw = await readFile(file, 'utf8');
        const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/u);
        const meta = frontmatter ? parse(frontmatter[1]) : {};
        const path = relative(base, file).replace(/\.mdx$/u, '');
        if (apiOnly && !path.startsWith('api/')) continue;
        counts[path.startsWith('api/') ? 'api' : 'nonApi']++;
        const result = securityReview({ ...meta, path, body: raw });
        if (result.blocks.length || result.warnings.length) findings.push({ path, blocks: result.blocks, warnings: result.warnings });
      }
    }
  };
  await walk(base);
  return { findings: findings.sort((a, b) => a.path.localeCompare(b.path)), counts };
}

export async function auditApiPages(root) {
  return (await auditPages(root, { apiOnly: true })).findings;
}
