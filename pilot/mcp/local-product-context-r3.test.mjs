import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllowedSourcePath, searchLocalProductContext } from './local-product-context.mjs';
import { planContent } from './content-ai-service.mjs';

const base = await realpath(await mkdtemp(join(tmpdir(), 'm530-r3-')));
const checkout = join(base, 'front');
await mkdir(checkout);
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Fixture');
const files = {
  'src/pages/Robots/Safe.tsx': 'export const label = "Criar robô";',
  'src/pages/Robots/Control.tsx': '// Criar robô sk-\u200bproj-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
  'src/config/api-keys.ts': 'export const label = "Criar robô fixture-api-keys";',
  'src/.env.local.ts': 'export const label = "Criar robô fixture-env-local";',
  'src/components/secrets.tsx': 'export const label = "Criar robô fixture-secrets";',
  'src/internal/Other.tsx': 'export const label = "Criar robô fixture-outside-allowlist";',
};
for (const [path, content] of Object.entries(files)) {
  await mkdir(join(checkout, path, '..'), { recursive: true });
  await writeFile(join(checkout, path), content);
}
git('add', '-A');
git('commit', '-qm', 'fixture');
const original = process.env.PRODUCT_LOCAL_CHECKOUT;
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
try {
  for (const path of Object.keys(files).filter((path) => path !== 'src/pages/Robots/Safe.tsx')) {
    if (path !== 'src/pages/Robots/Control.tsx') assert.equal(isAllowedSourcePath(path), false, `${path} inelegível`);
  }
  assert.equal(isAllowedSourcePath('src/pages/Robots/Safe.tsx'), true);
  const result = await searchLocalProductContext('Criar robô', 'Robôs', { repositoryIds: ['frontend'] });
  assert.equal(result.code[0].available, true, result.code[0].reason);
  assert.deepEqual(result.matches.map(({ path }) => path), ['src/pages/Robots/Safe.tsx']);
  const forbidden = /fixture-api-keys|fixture-env-local|fixture-secrets|fixture-outside-allowlist|ABCDEFGHIJKLMNOPQRSTUVWXYZ123456|Control\.tsx|api-keys\.ts|\.env\.local\.ts|secrets\.tsx|Other\.tsx/u;
  assert.doesNotMatch(JSON.stringify(result), forbidden);
  let prompt;
  await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Criar robô', module: 'Robôs', description: 'Explicar a tela.' },
    { contextOptions: { repositoryIds: ['frontend'] }, client: { responses: { create: async (request) => {
      prompt = JSON.stringify(request);
      return { model: 'fixture', output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
    } } } });
  assert.ok(prompt);
  assert.doesNotMatch(prompt, forbidden);
} finally {
  if (original === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
  else process.env.PRODUCT_LOCAL_CHECKOUT = original;
}
console.log('M5.30 r3: allowlist, arquivos sensíveis e prompt passaram.');
