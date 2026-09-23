import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { auditContent, parseArticle, renderNormalizedArticle } from '../mcp/editorial-standard.mjs';

const root = new URL('../', import.meta.url).pathname;
const contentRoot = join(root, 'content/docs');

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(target));
    else if (entry.name.endsWith('.mdx')) output.push(target);
  }
  return output;
}

for (const file of await walk(contentRoot)) {
  const path = relative(contentRoot, file).replace(/\.mdx$/, '');
  const raw = await readFile(file, 'utf8');
  const normalized = renderNormalizedArticle(parseArticle(raw, path));
  if (normalized !== raw) await writeFile(file, normalized);
}

const result = await auditContent(root);
console.log(`Normalização concluída: ${result.valid}/${result.total} artigos atendem ao padrão editorial.`);
if (result.invalid) {
  for (const article of result.articles) console.log(`- ${article.path}: ${article.issues.join('; ')}`);
  process.exitCode = 1;
}
