import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const smoke = await readFile(new URL('./ui-smoke.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const buildJob = workflow.split('  release-build:')[0];
const testFiles = [
  ['./ui-smoke.mjs', smoke],
  ['./visual/site-navigation.mjs', await readFile(new URL('./visual/site-navigation.mjs', import.meta.url), 'utf8')],
  ['./visual/assistant-legibility.mjs', await readFile(new URL('./visual/assistant-legibility.mjs', import.meta.url), 'utf8')],
  ['./guide-browser-journey.mjs', await readFile(new URL('./guide-browser-journey.mjs', import.meta.url), 'utf8')],
];

for (const [file, source] of testFiles) {
  assert.ok(/import\s*\{[^}]*assistantDisplayName[^}]*\}\s*from\s*['"][^'"]*assistant-name\.ts['"]/.test(source), `${file}: teste deve importar o nome canônico`);
  assert.ok(/(?:name:|assert\.(?:equal|match))[^\n]*assistantDisplayName|assistantDisplayName[^\n]*(?:name:|assert\.(?:equal|match))/.test(source), `${file}: teste deve usar o nome canônico`);
}

const forbidden = [
  ['assistente', 'virtual', 'do', 'iHelp'].join(' '),
  ['Claricia', '—', 'assistente', 'virtual', 'do', 'iHelp'].join(' '),
];
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'out', '.git'].includes(entry.name)) continue;
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
    if (entry.isDirectory()) await scan(url);
    else if (/\.(?:ts|tsx|mjs|json)$/.test(entry.name) && url.pathname !== new URL('../lib/assistant-name.ts', import.meta.url).pathname) {
      const source = await readFile(url, 'utf8');
      for (const oldName of forbidden) assert.ok(!source.includes(oldName), `${url.pathname}: nome antigo fora de lib/assistant-name.ts`);
    }
  }
}
await scan(new URL('../', import.meta.url));

assert.equal((smoke.match(/getByRole\('heading', \{ name: assistantDisplayName \}\)/g) ?? []).length, 2, 'abertura e nova conversa devem usar o nome canônico');
assert.equal((smoke.match(/getByRole\('(?:link|dialog)', \{ name: assistantDisplayName \}\)/g) ?? []).length, 3, 'link e painéis devem usar o nome canônico');
assert.ok(/- name: Build website[\s\S]*?- name: Check UI smoke in Chrome\n\s*run: npm run qa:ui/.test(buildJob), 'qa:ui deve rodar no job build depois do build');

console.log('qa:ui usa o nome canônico e roda no job build.');
