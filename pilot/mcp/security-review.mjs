import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { sensitiveKinds } from './sensitive-data.mjs';

const allowedHosts = new Set(['apiv3.ihelpchat.com', 'ihelpchat.com.br', 'www.ihelpchat.com.br']);
const unique = (values) => [...new Set(values)];
const endpointName = (article) => `${String(article.method ?? 'GET').toUpperCase()} ${article.endpoint ?? ''}`.trim();
const stringsOf = (value) => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(stringsOf)
    : value && typeof value === 'object' ? Object.values(value).flatMap(stringsOf) : [];
const normalizedIds = (text) => [...text.matchAll(/(?<![\da-f])[\da-f][\da-f_:\s-]{22,70}[\da-f](?![\da-f])/giu)]
  .some(([candidate]) => [24, 32].includes(candidate.replace(/[-_\s:]/gu, '').length)
    && /^[\da-f]+$/iu.test(candidate.replace(/[-_\s:]/gu, '')));

export function securityReview(article, { facts = {}, request = {} } = {}) {
  const blocks = [];
  const warnings = [];
  const body = String(article.body ?? '');
  const text = stringsOf(article).join('\n');
  const kinds = sensitiveKinds(text);
  if (kinds.personal) blocks.push('Exemplo contém possível dado pessoal (telefone, e-mail ou CPF/CNPJ). Use apenas valores sintéticos.');
  if (kinds.credential || kinds.internal || kinds.control) blocks.push('Conteúdo contém possível segredo ou informação interna.');
  if (normalizedIds(text))
    blocks.push('Exemplo contém id real (ObjectId ou UUID). Use id-exemplo-1.');
  if (/\/(?!5500000000000(?:[/?#\s"'`]|$))(?:\d{6,})(?:[/?#\s"'`]|$)/u.test(text)) blocks.push('Path de exemplo contém id numérico real. Use id-exemplo-1.');
  for (const match of text.matchAll(/https?:\/\/[^\s<>)"'`]+/giu)) {
    try {
      const url = new URL(match[0].replace(/[.,;:!?]+$/u, ''));
      if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password)
        blocks.push('URL ou host fora da API pública e do site do FAQ.');
    } catch { blocks.push('URL inválida na página.'); }
  }
  if (/\b(?:role|policy|papel|política)\s*(?:exigid[ao]|de autorização)?\s*[:=]\s*[A-Za-z][\w.-]+|\b(?:role|policy)\s+[A-Z][\w.-]+/iu.test(text))
    blocks.push('Detalhe de role ou policy de autorização: diga apenas “requer autenticação”.');
  for (const parameter of facts.parameters ?? []) {
    if (parameter.serverAssigned === true) blocks.push(`Parâmetro ${parameter.name} é preenchido pelo servidor (serverAssigned).`);
  }
  const exampleValues = [...text.matchAll(/(?:"(?:name|nome|contactName|personName)"\s*:\s*"|(?:name|nome)=["'])([^"'\n]+)["']/giu)].map((match) => match[1]);
  if (exampleValues.some((value) => /\b\p{Lu}\p{Ll}{2,}(?:\s+-\s+\w+|\s+\p{Lu}\p{Ll}{2,})/u.test(value)))
    blocks.push('Exemplo contém nome de pessoa. Use “Pessoa Exemplo”.');

  const method = String(article.method ?? '').toUpperCase();
  const route = String(article.endpoint ?? '');
  if (method === 'DELETE' || /(?:massdelete|mass|import|export|sync|delete|showall)/iu.test(route))
    warnings.push(`${endpointName(article)} pode apagar ou movimentar muitos dados. Confirme que deve ser documentado.`);
  if (/\bshowAll\b|\bexport\b/iu.test(text))
    warnings.push(`${endpointName(article)} pode devolver todos os dados sem paginação.`);
  const confirmation = `confirmo documentar: ${endpointName(article)}`;
  const confirmed = typeof request.confirmation === 'string' && request.confirmation.trim() === confirmation;
  return { blocks: unique(blocks), warnings: unique(warnings), ...(warnings.length ? { confirmed, confirmation } : {}) };
}

export async function auditApiPages(root) {
  const base = join(root, 'content/docs/api');
  const findings = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        const raw = await readFile(file, 'utf8');
        const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/u);
        const meta = frontmatter ? parse(frontmatter[1]) : {};
        const path = `api/${relative(base, file).replace(/\.mdx$/u, '')}`;
        const result = securityReview({ ...meta, path, body: raw });
        if (result.blocks.length || result.warnings.length) findings.push({ path, blocks: result.blocks, warnings: result.warnings });
      }
    }
  };
  await walk(base);
  return findings.sort((a, b) => a.path.localeCompare(b.path));
}
