import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { searchLocalProductContext } from './local-product-context.mjs';
import { screenshotForStep } from './screen-capture-manifest.mjs';
import { readScreenshot, screenshotLocation } from './screenshot-files.mjs';
import { containsSensitiveData } from './sensitive-data.mjs';
export { captureFailureCategory, captureFailureLog } from './capture-diagnostics.mjs';

const slug = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const defaultRoot = () => resolve(process.env.MCP_STATE_DIR ?? '/data', 'screens');

export function captureStepsLog(steps) {
  const safeReason = (value) => {
    if (/^(?:capturado|alvo fora da tela|máscara não cobriu|tempo do passo esgotado|rótulo não encontrado: \d+ candidatos|rota não abriu: \/[a-z0-9/_-]*|bloqueado pela lista de hosts: [a-z0-9.-]+)$/iu.test(value)) return value;
    const match = /^rótulo não encontrado: (\d+) candidatos; controles: (.*); spinner\/skeleton: (sim|não)$/u.exec(value ?? '');
    if (!match) return '[motivo omitido]';
    const controls = match[2].split(' | ');
    if (controls.length > 20 || controls.some((label) => label.length > 40
      || !/^[\p{L}\p{N} .,:;()!?+/-]+$/u.test(label)
      || containsSensitiveData(label, { detectOpaque: true }))) return '[motivo omitido]';
    return value;
  };
  const safe = steps.map(({ step, label, status, motivo, finalPath, pageTitle, candidates }) => ({
    step: slug.test(step) ? step : '[passo omitido]',
    label: typeof label === 'string' && label.length <= 160 && !containsSensitiveData(label, { detectOpaque: true })
      ? label.replace(/[\r\n]/gu, ' ') : '[rótulo omitido]',
    status: ['capturado', 'pendente', 'descartado'].includes(status) ? status : 'pendente',
    motivo: safeReason(motivo),
    finalPath: /^\/[a-z0-9/_-]*$/iu.test(finalPath) ? finalPath : '[caminho omitido]',
    pageTitle: typeof pageTitle === 'string' && pageTitle.length <= 100 && !/[\r\n]/u.test(pageTitle)
      && !containsSensitiveData(pageTitle, { detectOpaque: true }) ? pageTitle : '[título omitido]',
    candidates: Number.isInteger(candidates) && candidates >= 0 ? candidates : 0,
  }));
  return `capturar_telas: steps=${JSON.stringify(safe)}`;
}

export async function capturePage(input, {
  baseUrl = process.env.GUIDE_QA_STAGING_URL,
  root = defaultRoot(), fixture = false, env = process.env, coverage, storageState,
  faqRoot = resolve(import.meta.dirname, '../content/docs'),
  getScreenFacts = async (module) => {
    const result = await searchLocalProductContext(module, module, { repositoryIds: ['frontend'] });
    const front = result.code.find((item) => item.role === 'frontend' && item.available);
    if (!front?.screenFacts?.length) throw new Error('Fatos da tela indisponíveis');
    return front.screenFacts;
  },
} = {}) {
  if (!input || Object.keys(input).some((key) => !['path', 'module'].includes(key)))
    throw new Error('Plano do chamador: entrada não permitida');
  const { path, module } = input;
  if (typeof path !== 'string' || !/^docs\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/u.test(path)
    || typeof module !== 'string' || !module.trim()) throw new Error('Página inválida');
  const page = path.split('/').at(-1);
  const { capturePlan, captureScreens } = await import('../scripts/screen-capture/capture.mjs');
  if (!baseUrl) throw new Error('Destino de QA ausente');
  const matrix = coverage ?? JSON.parse(await readFile(new URL('../architecture/coverage-matrix.json', import.meta.url), 'utf8'));
  const screenFacts = await getScreenFacts(module);
  let faqBody;
  try { faqBody = await readFile(join(env.MCP_STATE_DIR ?? '/data', '.drafts', `${path}.mdx`), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    faqBody = await readFile(join(faqRoot, `${path}.mdx`), 'utf8');
  }
  const plan = capturePlan({ page, module, faqBody, screenFacts, coverage: matrix });
  if (plan.length > 20) throw new Error('Plano excede 20 passos');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '{"version":1,"entries":[]}';
    throw error;
  }));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Manifesto de telas inválido');
  return captureScreens({ baseUrl, plan, root, fixture, env, manifest, storageState,
    vocabulary: [
      ...screenFacts.map((fact) => fact.text).filter((text) => typeof text === 'string'),
      // TabsRobots renders the static tab name from _tabs and appends a runtime count.
      ...(module === 'Robôs' ? ['Lista de Robôs ({count})'] : []),
    ] });
}

export async function uploadPage({ page, step, base64, alt }, { root = defaultRoot() } = {}) {
  const { addUploadedScreenshot } = await import('../scripts/screen-capture/capture.mjs');
  if (!slug.test(page ?? '') || !slug.test(step ?? '') || typeof base64 !== 'string'
    || base64.length > 3 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64))
    throw new Error('Upload de tela inválido');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '{"version":1,"entries":[]}';
    throw error;
  }));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Manifesto de telas inválido');
  return addUploadedScreenshot({ manifest, page, step, bytes: Buffer.from(base64, 'base64'), alt,
    root });
}

export async function approvePage({ page, step, token, approvedBy }, { root = defaultRoot(), env = process.env } = {}) {
  if (!slug.test(page ?? '') || !slug.test(step ?? '') || !/^(?:(?:user|service):)?[a-z0-9][a-z0-9_-]{2,63}$/iu.test(approvedBy ?? ''))
    throw new Error('Aprovação inválida');
  const expected = env.SCREEN_CAPTURE_ADMIN_TOKEN;
  let mcpKeys = [];
  try { mcpKeys = JSON.parse(env.DOCS_MCP_CREDENTIALS ?? '[]').map((entry) => entry.key); }
  catch { throw new Error('Credenciais MCP inválidas'); }
  if (typeof expected !== 'string' || expected.length < 24 || expected === env.DOCS_MCP_API_KEY || mcpKeys.includes(expected)
    || typeof token !== 'string') throw new Error('Token admin inválido');
  const digest = (value) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(token), digest(expected))) throw new Error('Token admin inválido');
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Manifesto de telas inválido');
  const entry = manifest.entries.find((item) => item.page === page && item.step === step && item.source === 'upload' && item.status === 'pending');
  if (!entry) throw new Error('Upload pendente ausente');
  const { bytes, extension } = await readScreenshot(root, entry);
  if (bytes.length > MAX_IMAGE_BYTES || extension === 'png' && bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || extension === 'jpg' && bytes.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new Error('Upload pendente inválido');
  entry.status = 'approved'; entry.approvedBy = approvedBy; entry.approvedAt = new Date().toISOString();
  entry.masked = ['revisão humana'];
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
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
  const eligible = manifest.entries.filter((entry) => entry.page === page && slug.test(entry.step)
    && (entry.source !== 'upload' || entry.status === 'approved')
    && (() => { try { screenshotLocation(root, entry); return true; } catch { return false; } })());
  const entries = eligible.filter((entry) => screenshotForStep(manifest, page, entry.step) === entry).slice(0, limit);
  let total = 0;
  const images = [];
  for (const entry of entries) {
    const { bytes, extension } = await readScreenshot(root, entry);
    total += bytes.length;
    if (bytes.length > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('Imagens excedem o teto da chamada');
    if (extension === 'png' ? bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      : bytes.subarray(0, 3).toString('hex') !== 'ffd8ff') throw new Error('Imagem inválida');
    images.push({ step: entry.step, file: entry.file, mimeType: `image/${extension === 'jpg' ? 'jpeg' : 'png'}`, base64: bytes.toString('base64') });
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
    for (const match of article.body.matchAll(/!\[[^\]\n]+\]\((\/img\/mcp\/([a-z0-9-]+)\/([^\s)]+))\)/gu)) {
      const [, file, imagePage, name] = match;
      const parsed = /^([a-z0-9][a-z0-9-]{0,79})\.(?:automatic|upload)\.[a-f0-9]{64}\.(?:png|jpg)$/u.exec(name);
      if (!parsed) throw new Error('Referência de imagem inválida');
      const step = parsed[1];
      if (imagePage !== page || !slug.test(step)) throw new Error('Imagem fora da página do artigo');
      const entry = screenshotForStep(manifest, page, step);
      if (entry?.file !== file)
        throw new Error('Imagem citada sem captura aprovada');
      const { bytes, extension } = await readScreenshot(root, entry);
      if (bytes.length > MAX_IMAGE_BYTES || (extension === 'png' ? bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        : bytes.subarray(0, 3).toString('hex') !== 'ffd8ff'))
        throw new Error('Imagem citada inválida ou grande demais');
      used.set(file, bytes.toString('base64'));
    }
  }
  return [...used].map(([file, base64]) => ({ file: `pilot/public${file}`, base64 }));
}
