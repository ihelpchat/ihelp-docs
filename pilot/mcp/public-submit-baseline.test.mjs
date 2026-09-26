import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import baseline from './public-submit-baseline.json' with { type: 'json' };
import { parseArticle } from './editorial-standard.mjs';
import { assertPublicSubmit } from './public-submit-gate.mjs';

const root = new URL('../', import.meta.url).pathname.replace(/\/$/u, '');
const contentRoot = join(root, 'content/docs');
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (file.endsWith('.mdx')) files.push(file);
  }
  return files;
}

let valid = 0;
const stillFailing = new Set();
for (const file of await walk(contentRoot)) {
  const path = relative(contentRoot, file).replace(/\.mdx$/u, '');
  const raw = await readFile(file, 'utf8');
  const { metadata, body } = parseArticle(raw, path);
  try {
    await assertPublicSubmit(root, [{ article: { path, ...metadata, body }, rendered: raw }], [], { ignoreBaseline: true });
    valid++;
  } catch (error) {
    assert.equal(baseline[path], createHash('sha256').update(raw).digest('hex'), `${path}: falha nova no gate: ${error.message}`);
    stillFailing.add(path);
  }
}
assert.deepEqual([...stillFailing].sort(), Object.keys(baseline).sort(), 'retire do baseline as páginas corrigidas');
console.log(`Gate publicado: ${valid} válidas, ${stillFailing.size} no baseline`);
