// Mede a busca da base de conhecimento contra um gabarito privado de frases reais.
// Uso: KB_GOLD_FILE=<gabarito.json> node scripts/kb-eval.mjs [--embeddings]
// O gabarito fica FORA deste repositório (frases de clientes, mesmo anonimizadas, não vão para repo público).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../mcp/kb-build.mjs';
import { createSearch, pagesOf } from '../mcp/kb-search.mjs';
import { retrieveContext, semanticRanksFor } from '../mcp/assistant-service.mjs';
import { searchContent } from '../mcp/content-service.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const goldFile = process.env.KB_GOLD_FILE;
if (!goldFile) { console.error('Defina KB_GOLD_FILE com o caminho do gabarito privado.'); process.exit(2); }
const { casos } = JSON.parse(await readFile(goldFile, 'utf8'));
const withEmbeddings = process.argv.includes('--embeddings');

let embed; let embedQuery;
if (withEmbeddings) ({ embed, embedQuery } = await (await import('../mcp/kb-embed.mjs')).createEmbedder());

const index = await buildIndex(root, { embed });
const search = createSearch(index, { embedQuery });
const clean = (path) => String(path ?? '').replace(/^\//, '');
const rankOf = (paths, aceita) => {
  const at = paths.findIndex((path) => aceita.some((suffix) => clean(path).endsWith(suffix) || clean(path).includes(`${suffix}/`)));
  return at < 0 ? null : at + 1;
};

const systems = {
  'busca do MCP (docs_search)': async (frase) => (await searchContent(root, frase, 6).catch(() => [])).map(({ path }) => path),
  'Claricia hoje (retrieveContext)': async (frase) => (await retrieveContext(root, frase, 6)).map((item) => item.path ?? item.url ?? ''),
  'Claricia + base nova': async (frase) => (await retrieveContext(root, frase, 6, { semanticRanks: await semanticRanksFor(search, frase) })).map((item) => item.path ?? ''),
  [`base nova (${withEmbeddings ? 'sentido + palavra' : 'só palavra'})`]: async (frase) =>
    pagesOf((await search({ query: frase, sources: ['faq'], limit: 24 })).hits).slice(0, 6).map(({ path }) => path),
};

const rows = [];
for (const [name, run] of Object.entries(systems)) {
  let top1 = 0; let top3 = 0; let top6 = 0; const misses = [];
  for (const caso of casos) {
    const rank = rankOf(await run(caso.frase), caso.aceita);
    if (rank === 1) top1++;
    if (rank && rank <= 3) top3++;
    if (rank) top6++; else misses.push(caso.n);
  }
  rows.push({ sistema: name, top1, top3, top6, total: casos.length, foraDoTop6: misses.join(',') });
}
const pct = (value, total) => `${value}/${total} (${Math.round(100 * value / total)}%)`;
for (const row of rows) console.log(`${row.sistema}\n  1º lugar: ${pct(row.top1, row.total)} | top 3: ${pct(row.top3, row.total)} | top 6: ${pct(row.top6, row.total)}\n  fora do top 6: ${row.foraDoTop6 || '—'}`);
console.log(`\níndice: ${index.chunks.length} trechos, versão ${index.version}`);
