import { containsSensitiveData } from './sensitive-data.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { screenshotLocation } from './screenshot-files.mjs';

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
    && (() => { try { screenshotLocation('', entry); return true; } catch { return false; } })()
    && (entry.source !== 'upload' || entry.status === 'approved')
    && (entry.source === 'upload' || /^[a-f0-9]{40}$/u.test(entry.bundleSha ?? entry.appSha ?? ''))
    && typeof entry.alt === 'string' && !containsSensitiveData(entry.alt));
  return matches.find((entry) => entry.source === 'upload') ?? matches.find((entry) => entry.source === 'automatic') ?? null;
}

export function attachScreenshotsToArticle(article, manifest, expectedSha, screenFacts = []) {
  if (!manifest?.entries?.length || !article?.body || !article?.path) return article;
  const page = article.path.split('/').at(-1);
  const lines = article.body.split('\n');
  const numberedLines = lines.map((line, index) => /^\s*\d+[.)]\s+/u.test(line) ? index : -1).filter((index) => index >= 0);
  const steps = [...new Set(manifest.entries.filter((entry) => entry.page === page).map((entry) => entry.step))];
  const insertions = [];
  for (const step of steps) {
    const image = screenshotForStep(manifest, page, step);
    if (!image || !image.label || /[\[\]\n\r]/u.test(image.alt)) continue;
    if (image.source === 'automatic' && (!/^[a-f0-9]{40}$/u.test(expectedSha ?? '')
      || image.checkoutSha !== expectedSha)) continue;
    const identity = manifest.entries.filter((entry) => entry.page === page
      && normalized(entry.label ?? '') === normalized(image.label)
      && (entry.route !== image.route || entry.owner !== image.owner));
    if (identity.length) continue;
    if (screenFacts.length && !screenFacts.some((fact) => normalized(fact.text ?? '') === normalized(image.label)
      && fact.route === image.route && fact.owner === image.owner && (image.source === 'upload' || fact.sha === expectedSha))) continue;
    if (lines.some((value) => value.includes(`](${image.file})`))) continue;
    const line = Number.isInteger(image.line)
      && (image.listIndex === null || Number.isInteger(image.listIndex) && numberedLines[image.listIndex] === image.line)
      && normalized(lines[image.line] ?? '').includes(normalized(image.label)) ? image.line
      : image.line == null && image.listIndex == null && numberedLines.length === 0
        ? lines.findIndex((value) => normalized(value).includes(normalized(image.label)) && !value.startsWith('![')) : -1;
    if (line < 0) continue;
    insertions.push({ line, value: `![${image.alt}](${image.file})` });
  }
  for (const { line, value } of insertions.sort((a, b) => b.line - a.line)) lines.splice(line + 1, 0, '', value, '');
  return { ...article, body: lines.join('\n') };
}

export function screenshotVersionWarnings(articles, manifest, expectedSha) {
  if (!manifest?.entries) return [];
  const awaiting = manifest.entries.filter((entry) => entry.source === 'upload' && entry.status === 'pending'
    && articles.some((article) => article.path?.split('/').at(-1) === entry.page))
    .map((entry) => `print enviado aguardando revisão: ${entry.page}/${entry.step}`);
  const discarded = manifest.pending ?? [];
  return [...awaiting, ...discarded, ...manifest.entries.filter((entry) => entry.source === 'automatic'
    && /^[a-f0-9]{40}$/u.test(entry.checkoutSha ?? '')
    && /^[a-f0-9]{40}$/u.test(expectedSha ?? '')
    && entry.checkoutSha !== expectedSha
    && articles.some((article) => article.path?.split('/').at(-1) === entry.page
      && article.body?.split('\n').some((line) => normalized(line).includes(normalized(entry.label ?? '')))))
    .map((entry) => `print de versão anterior: recapturar ${entry.page}/${entry.step}`)];
}

export function screenshotReviewBody(baseBody, warnings) {
  return warnings.length ? `${baseBody}\n\n## Prints a revisar\n\n${warnings.map((warning) => `- ${warning}`).join('\n')}` : baseBody;
}
