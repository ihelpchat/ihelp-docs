import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const writers = new Set(['createDraft', 'createPullRequest', 'createPackagePullRequest']);

function unguardedExports(source) {
  const functions = new Map();
  const exports = [];
  const declarations = [...source.matchAll(/^(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gmu)];
  for (const [index, match] of declarations.entries()) {
    const body = source.slice(match.index, declarations[index + 1]?.index ?? source.length);
    functions.set(match[2], new Set([...body.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\s*\(/gu)].map((call) => call[1])));
    if (match[1]) exports.push(match[2]);
  }
  const reaches = (name, target, visited = new Set()) => {
    if (visited.has(name)) return false;
    visited.add(name);
    return [...functions.get(name) ?? []].some((callee) => target.has(callee)
      || (functions.has(callee) && reaches(callee, target, visited)));
  };
  return exports.filter((name) => reaches(name, writers)
    && !reaches(name, new Set(['assertPublicSubmit'])));
}

test('todo export que alcança escrita de página alcança o gate único', async () => {
  const source = await readFile(new URL('./content-service.mjs', import.meta.url), 'utf8');
  assert.deepEqual(unguardedExports(source), []);
  const bypass = `${source}\nexport async function bypass(root, article) { return createDraft(root, article, 'unsafe'); }\n`;
  assert.deepEqual(unguardedExports(bypass), ['bypass'], 'um export novo sem gate precisa falhar');
});

function generatedPagesGuarded(source) {
  const declarations = [...source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gmu)];
  const bodyOf = (name) => {
    const index = declarations.findIndex((match) => match[1] === name);
    return index < 0 ? '' : source.slice(declarations[index].index, declarations[index + 1]?.index ?? source.length);
  };
  const finalizer = bodyOf('finalizeGeneratedPages');
  const packageCore = bodyOf('generateContentPackageCore');
  const guide = bodyOf('generateCanonicalGuide');
  return finalizer.includes('securityReview(')
    && [...packageCore.matchAll(/return finalizeGeneratedPages\(/gu)].length === 2
    && /return finalizeGeneratedPages\(/u.test(guide);
}

test('todo caminho que devolve página pronta passa pela revisão', async () => {
  const source = await readFile(new URL('./content-ai-service.mjs', import.meta.url), 'utf8');
  assert.equal(generatedPagesGuarded(source), true);
  assert.equal(generatedPagesGuarded(source.replace('return finalizeGeneratedPages(', 'return (')), false,
    'remover a revisão do caminho de devolução precisa falhar');
});
