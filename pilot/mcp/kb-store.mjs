import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { businessChunks, moduleResolver, supportChunks } from './kb-chunk.mjs';
import { embeddingInput, loadFaqChunks } from './kb-build.mjs';
import { createSearch } from './kb-search.mjs';

// Monta e guarda a base de conhecimento do serviço.
// Os vetores ficam em disco por id de trecho: a cada subida só o que mudou é enviado ao provedor.

const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } };
const encode = (vector) => Buffer.from(new Float32Array(vector).buffer).toString('base64');
const decode = (text) => { const bytes = Buffer.from(text, 'base64'); return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4); };

export async function collectChunks(root, { businessContext = [], extraChunks = [] } = {}) {
  const [{ chunks: published, skipped }, coverage, signals] = await Promise.all([
    loadFaqChunks(root),
    readJson(join(root, 'architecture/coverage-matrix.json'), []),
    readJson(join(root, 'architecture/support-signals.json'), {}),
  ]);
  const moduleOf = moduleResolver(coverage);
  const all = [
    ...published.map((chunk) => ({ ...chunk, module: chunk.module ?? moduleOf(chunk.ref.path) })),
    ...supportChunks(signals), ...businessChunks(businessContext), ...extraChunks,
  ];
  const seen = new Set();
  return { chunks: all.filter(({ id }) => !seen.has(id) && seen.add(id)), skipped };
}

// stateDir: MCP_STATE_DIR. embedder: saída de createEmbedder() ou null (só palavra).
export async function openKnowledgeBase(root, { stateDir, embedder = null, businessContext, extraChunks, batchSize = 64, log = () => {} } = {}) {
  const { chunks, skipped } = await collectChunks(root, { businessContext, extraChunks });
  const version = createHash('sha256').update(chunks.map(({ id }) => id).join('\n')).digest('hex').slice(0, 16);
  let vectors = null;
  let embedded = 0;
  if (embedder) {
    const file = stateDir ? join(stateDir, 'kb', `vectors-${embedder.model}.json`) : null;
    const cache = file ? await readJson(file, {}) : {};
    const missing = chunks.filter(({ id }) => !cache[id]);
    try {
      for (let start = 0; start < missing.length; start += batchSize) {
        const batch = missing.slice(start, start + batchSize);
        const result = await embedder.embed(batch.map(embeddingInput));
        batch.forEach(({ id }, index) => { cache[id] = encode(result[index]); });
        embedded += batch.length;
      }
    } catch (error) {
      // Provedor fora: o que já tem vetor continua valendo; o resto busca só por palavra.
      log(`base de conhecimento: vetores incompletos (${error instanceof Error ? error.message : 'erro'})`);
    }
    if (file && embedded) {
      // Guarda só os vetores de trechos vivos, para o arquivo não crescer para sempre.
      const live = Object.fromEntries(chunks.filter(({ id }) => cache[id]).map(({ id }) => [id, cache[id]]));
      await mkdir(join(stateDir, 'kb'), { recursive: true, mode: 0o700 });
      await writeFile(`${file}.tmp`, JSON.stringify(live), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    }
    vectors = chunks.map(({ id }) => cache[id] ? decode(cache[id]) : null);
  }
  const index = { version, chunks, vectors };
  return { index, skipped, embedded, withVectors: vectors?.filter(Boolean).length ?? 0,
    search: createSearch(index, { embedQuery: embedder?.embedQuery }) };
}

// Uma base por processo, compartilhada entre a Claricia e o agente editor. Montada na primeira chamada.
const shared = new Map();
export function sharedKnowledgeBase(root) {
  if (!shared.has(root)) {
    shared.set(root, (async () => {
      const { loadBusinessContext } = await import('./faq-editorial.mjs');
      const embedder = process.env.OPENAI_API_KEY ? await (await import('./kb-embed.mjs')).createEmbedder() : null;
      return openKnowledgeBase(root, { stateDir: process.env.MCP_STATE_DIR, embedder,
        businessContext: await loadBusinessContext(root, null).catch(() => []), log: (line) => console.error(line) });
    })().catch((error) => { shared.delete(root); throw error; }));
  }
  return shared.get(root);
}
