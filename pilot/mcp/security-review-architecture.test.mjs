import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const writers = new Set(['createDraft', 'createPullRequest', 'createPackagePullRequest']);

function unguardedExports(source) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const functions = new Map();
  const exports = [];
  for (const node of tree.body) {
    const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (declaration?.type !== 'FunctionDeclaration') continue;
    const calls = new Set();
    simple(declaration.body, { CallExpression(call) {
      if (call.callee.type === 'Identifier') calls.add(call.callee.name);
    } });
    functions.set(declaration.id.name, calls);
    if (node.type === 'ExportNamedDeclaration') exports.push(declaration.id.name);
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
