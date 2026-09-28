import { containsSensitiveData } from './sensitive-data.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function loadScreenshotManifest(_root) {
  try {
    const raw = await readFile(join(process.env.MCP_STATE_DIR ?? '/data', 'screens/manifest.json'), 'utf8');
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error('Manifesto de screenshots inválido');
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const normalized = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();

export function screenshotForStep(manifest, page, step) {
  if (!manifest || !Array.isArray(manifest.entries)) return null;
  const matches = manifest.entries.filter((entry) => entry.page === page && entry.step === step
    && entry.file === `/img/mcp/${page}/${step}.png`
    && (entry.source === 'upload' || /^[a-f0-9]{40}$/u.test(entry.bundleSha ?? entry.appSha ?? ''))
    && typeof entry.alt === 'string' && !containsSensitiveData(entry.alt));
  return matches.find((entry) => entry.source === 'upload') ?? matches.find((entry) => entry.source === 'automatic') ?? null;
}

export function attachScreenshotsToArticle(article, manifest, _expectedSha, screenFacts = []) {
  if (!manifest?.entries?.length || !article?.body || !article?.path) return article;
  const page = article.path.split('/').at(-1);
  const lines = article.body.split('\n');
  const steps = [...new Set(manifest.entries.filter((entry) => entry.page === page).map((entry) => entry.step))];
  for (const step of steps) {
    const image = screenshotForStep(manifest, page, step);
    if (!image || !image.label || /[\[\]\n\r]/u.test(image.alt)) continue;
    const identity = manifest.entries.filter((entry) => entry.page === page
      && normalized(entry.label ?? '') === normalized(image.label)
      && (entry.route !== image.route || entry.owner !== image.owner));
    if (identity.length) continue;
    if (screenFacts.length && !screenFacts.some((fact) => normalized(fact.text ?? '') === normalized(image.label)
      && fact.route === image.route && fact.owner === image.owner)) continue;
    if (lines.some((value) => value.includes(`](${image.file})`))) continue;
    const line = lines.findIndex((value) => normalized(value).includes(normalized(image.label)) && !value.startsWith('!['));
    if (line < 0) continue;
    lines.splice(line + 1, 0, '', `![${image.alt}](${image.file})`, '');
  }
  return { ...article, body: lines.join('\n') };
}

export function screenshotVersionWarnings(articles, manifest) {
  if (!manifest?.entries) return [];
  return manifest.entries.filter((entry) => entry.source === 'automatic'
    && /^[a-f0-9]{40}$/u.test(entry.bundleSha ?? '')
    && /^[a-f0-9]{40}$/u.test(entry.checkoutSha ?? '')
    && entry.bundleSha !== entry.checkoutSha
    && articles.some((article) => article.path?.split('/').at(-1) === entry.page
      && article.body?.includes(`](${entry.file})`)))
    .map((entry) => `${entry.page}/${entry.step}: bundle e checkout divergentes; revisar print na homologação`);
}
