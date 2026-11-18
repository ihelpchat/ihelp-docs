import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { chunkArticle } from './kb-chunk.mjs';
import { parseArticle } from './editorial-standard.mjs';
import { containsSensitiveData } from './sensitive-data.mjs';

// Monta o índice da base de conhecimento a partir do conteúdo publicado.
// embed: async (textos[]) => vetores[] — opcional; sem ele o índice sai só com busca por palavra.

async function walk(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.name.endsWith('.mdx')) output.push(path);
  }
  return output.sort();
}

export async function loadFaqChunks(root) {
  const base = join(root, 'content/docs');
  const chunks = [];
  const skipped = [];
  for (const file of await walk(base)) {
    const raw = await readFile(file, 'utf8');
    const path = relative(base, file).replace(/\/index\.mdx$/, '').replace(/\.mdx$/, '');
    let article;
    try { article = parseArticle(raw, path); } catch { skipped.push({ path, reason: 'frontmatter inválido' }); continue; }
    const title = String(article.metadata.title ?? '').trim();
    if (!title) { skipped.push({ path, reason: 'sem título' }); continue; }
    for (const chunk of chunkArticle({ path, title, description: String(article.metadata.description ?? ''), body: article.body })) {
      // Dado sensível nunca entra no índice, nem em página já publicada.
      if (containsSensitiveData(`${chunk.title}\n${chunk.text}`)) { skipped.push({ path, reason: 'dado sensível' }); continue; }
      chunks.push(chunk);
    }
  }
  return { chunks, skipped };
}

export const embeddingInput = (chunk) => `${chunk.title}\n${chunk.text}`;

export async function buildIndex(root, { embed, batchSize = 64 } = {}) {
  const { chunks, skipped } = await loadFaqChunks(root);
  const version = createHash('sha256').update(chunks.map(({ id }) => id).join('\n')).digest('hex').slice(0, 16);
  let vectors = null;
  if (embed) {
    vectors = [];
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = await embed(chunks.slice(start, start + batchSize).map(embeddingInput));
      if (batch.length !== Math.min(batchSize, chunks.length - start)) throw new Error('embeddings: quantidade diferente da pedida');
      vectors.push(...batch);
    }
  }
  return { version, builtAt: new Date().toISOString(), chunks, vectors, skipped };
}
