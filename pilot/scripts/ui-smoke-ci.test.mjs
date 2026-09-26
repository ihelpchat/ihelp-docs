import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const smoke = await readFile(new URL('./ui-smoke.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const buildJob = workflow.split('  release-build:')[0];

assert.ok(/import\s*\{\s*assistantDisplayName\s*\}\s*from\s*['"]\.\.\/lib\/assistant-name\.ts['"]/.test(smoke), 'smoke deve importar o nome canônico');
assert.equal((smoke.match(/getByRole\('heading', \{ name: assistantDisplayName \}\)/g) ?? []).length, 2, 'abertura e nova conversa devem usar o nome canônico');
assert.ok(/- name: Build website[\s\S]*?- name: Check UI smoke in Chrome\n\s*run: npm run qa:ui/.test(buildJob), 'qa:ui deve rodar no job build depois do build');

console.log('qa:ui usa o nome canônico e roda no job build.');
