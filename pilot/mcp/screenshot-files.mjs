import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const slug = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const hash = /^[a-f0-9]{64}$/u;
const pattern = /^\/img\/mcp\/([a-z0-9][a-z0-9-]{0,79})\/([a-z0-9][a-z0-9-]{0,79})\.(automatic|upload)\.([a-f0-9]{64})\.(png|jpg)$/u;
export const screenshotHash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function screenshotFile(page, step, source, bytes, extension) {
  if (!slug.test(page) || !slug.test(step) || !['automatic', 'upload'].includes(source)
    || !['png', 'jpg'].includes(extension)) throw new Error('Caminho de imagem inválido');
  return `/img/mcp/${page}/${step}.${source}.${screenshotHash(bytes)}.${extension}`;
}

export function screenshotLocation(root, entry) {
  const match = pattern.exec(entry?.file ?? '');
  if (!match || match[1] !== entry.page || match[2] !== entry.step || match[3] !== entry.source
    || !hash.test(entry.sha256 ?? '') || match[4] !== entry.sha256)
    throw new Error('Referência de imagem inválida');
  return { path: join(root, entry.page, match[0].split('/').at(-1)), extension: match[5] };
}

export async function writeScreenshot(root, entry, bytes) {
  const { path } = screenshotLocation(root, entry);
  if (screenshotHash(bytes) !== entry.sha256) throw new Error('Hash da imagem divergente');
  await mkdir(join(root, entry.page), { recursive: true });
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (screenshotHash(await readFile(path)) !== entry.sha256) throw new Error('Integridade da imagem divergente');
  }
}

export async function readScreenshot(root, entry) {
  const { path, extension } = screenshotLocation(root, entry);
  const bytes = await readFile(path);
  if (screenshotHash(bytes) !== entry.sha256) throw new Error('Integridade da imagem divergente');
  return { bytes, extension };
}
