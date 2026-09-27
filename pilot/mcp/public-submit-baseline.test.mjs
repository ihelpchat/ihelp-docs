import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import baseline from './public-submit-baseline.json' with { type: 'json' };
import { parseArticle } from './editorial-standard.mjs';
import { assertPublicSubmit } from './public-submit-gate.mjs';
import { securityReview } from './security-review.mjs';

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
const securityFindings = new Set();
for (const file of await walk(contentRoot)) {
  const path = relative(contentRoot, file).replace(/\.mdx$/u, '');
  const raw = await readFile(file, 'utf8');
  const { metadata, body } = parseArticle(raw, path);
  if (path.startsWith('api/') && securityReview({ path, ...metadata, body }).blocks.length) {
    securityFindings.add(path);
    continue; // páginas legadas ficam na auditoria de segurança até a PR de correção
  }
  try {
    const result = await assertPublicSubmit(root, [{ article: { path, ...metadata, body }, rendered: raw }], [], { ignoreBaseline: true });
    if (path.startsWith('api/') && result.status === 'needs_information') {
      securityFindings.add(path);
      continue;
    }
    valid++;
  } catch (error) {
    assert.equal(baseline[path], createHash('sha256').update(raw).digest('hex'), `${path}: falha nova no gate: ${error.message}`);
    stillFailing.add(path);
  }
}
assert.deepEqual([...stillFailing].sort(), Object.keys(baseline).filter((path) => !securityFindings.has(path)).sort(), 'retire do baseline as páginas corrigidas');
console.log(`Gate publicado: ${valid} válidas, ${stillFailing.size} no baseline`);
