import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const slug = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const defaultRoot = () => resolve(process.env.MCP_STATE_DIR ?? '/data', 'screens');

export async function capturePage({ page, module, steps, screenFacts, appSha }, {
  baseUrl = process.env.GUIDE_QA_STAGING_URL,
  root = defaultRoot(), fixture = false, env = process.env, coverage,
} = {}) {
  const { capturePlan, captureScreens } = await import('../scripts/screen-capture/capture.mjs');
  if (!baseUrl) throw new Error('Destino de QA ausente');
  const matrix = coverage ?? JSON.parse(await readFile(new URL('../architecture/coverage-matrix.json', import.meta.url), 'utf8'));
  const plan = capturePlan({ page, module, steps, screenFacts, appSha, coverage: matrix });
  if (plan.length > 20) throw new Error('Plano excede 20 passos');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '{"version":1,"entries":[]}';
    throw error;
  }));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Manifesto de telas inválido');
  return captureScreens({ baseUrl, plan, appSha, root, fixture, env, manifest });
}

export async function downloadPage(page, { root = defaultRoot(), limit = MAX_IMAGES } = {}) {
  if (!slug.test(page) || !Number.isInteger(limit) || limit < 1 || limit > MAX_IMAGES)
    throw new Error('Consulta de telas inválida');
  let manifest;
  try { manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return { version: 1, entries: [], images: [] };
    throw error;
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Manifesto de telas inválido');
  const entries = manifest.entries.filter((entry) => entry.page === page && slug.test(entry.step)
    && entry.file === `/img/mcp/${page}/${entry.step}.png`).slice(0, limit);
  let total = 0;
  const images = [];
  for (const entry of entries) {
    const bytes = await readFile(join(root, page, `${entry.step}.png`));
    total += bytes.length;
    if (bytes.length > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('Imagens excedem o teto da chamada');
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Imagem inválida');
    images.push({ step: entry.step, file: entry.file, mimeType: 'image/png', base64: bytes.toString('base64') });
  }
  return { version: 1, entries, images };
}

export async function imagesUsedByArticles(articles, { root = defaultRoot() } = {}) {
  const used = new Map();
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '{"version":1,"entries":[]}';
    throw error;
  }));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Manifesto de telas inválido');
  for (const article of articles) {
    const page = article.path?.split('/').at(-1);
    if (!slug.test(page ?? '')) continue;
    for (const match of article.body.matchAll(/!\[[^\]\n]+\]\((\/img\/mcp\/([a-z0-9-]+)\/([a-z0-9-]+)\.png)\)/gu)) {
      const [, file, imagePage, step] = match;
      if (imagePage !== page || !slug.test(step)) throw new Error('Imagem fora da página do artigo');
      if (!manifest.entries.some((entry) => entry.page === page && entry.step === step && entry.file === file))
        throw new Error('Imagem citada sem captura aprovada');
      const bytes = await readFile(join(root, page, `${step}.png`));
      if (bytes.length > MAX_IMAGE_BYTES || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
        throw new Error('Imagem citada inválida ou grande demais');
      used.set(file, bytes.toString('base64'));
    }
  }
  return [...used].map(([file, base64]) => ({ file: `pilot/public${file}`, base64 }));
}
