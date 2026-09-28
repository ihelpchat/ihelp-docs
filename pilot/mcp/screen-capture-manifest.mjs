import { containsSensitiveData } from './sensitive-data.mjs';

export function screenshotForStep(manifest, page, step) {
  if (!manifest || !Array.isArray(manifest.entries)) return null;
  const matches = manifest.entries.filter((entry) => entry.page === page && entry.step === step
    && entry.file === `/img/mcp/${page}/${step}.png` && /^[a-f0-9]{40}$/u.test(entry.appSha ?? '')
    && typeof entry.alt === 'string' && !containsSensitiveData(entry.alt));
  return matches.find((entry) => entry.source === 'upload') ?? matches.find((entry) => entry.source === 'automatic') ?? null;
}

export function attachScreenshotsToArticle(article, manifest) {
  if (!manifest?.entries?.length || !article?.body || !article?.path) return article;
  const page = article.path.split('/').at(-1);
  const lines = article.body.split('\n');
  const steps = [...new Set(manifest.entries.filter((entry) => entry.page === page).map((entry) => entry.step))];
  for (const step of steps) {
    const image = screenshotForStep(manifest, page, step);
    if (!image || !image.label || /[\[\]\n\r]/u.test(image.alt)) continue;
    if (lines.some((value) => value.includes(`](${image.file})`))) continue;
    const line = lines.findIndex((value) => value.includes(image.label) && !value.startsWith('!['));
    if (line < 0) continue;
    lines.splice(line + 1, 0, '', `![${image.alt}](${image.file})`, '');
  }
  return { ...article, body: lines.join('\n') };
}
