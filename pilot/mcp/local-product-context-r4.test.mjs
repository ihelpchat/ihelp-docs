import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLocalProductContext } from './local-product-context.mjs';
import { planContent } from './content-ai-service.mjs';
import { containsSensitiveData, sensitiveKinds } from './sensitive-data.mjs';

const encoded = Buffer.from('sk-proj-SYNTHETIC-ONLY-0123456789abcdef').toString('base64');
const hex = Buffer.from('sk-proj-SYNTHETIC-ONLY-0123456789abcdef').toString('hex');
const random = 'Q8mF2vN7pL4xR9cT3kB6zY1hW5sD0jA8uE2gP4nV';
const safeRoute = '/robos/criar-robo/editar-robo/mostrar-robo';
const safeClass = 'botao-robo-botao-robo-botao-robo-botao-robo';
const files = {
  'src/pages/Robots/Encoded.tsx': `// Criar robô base64: ${encoded}`,
  'src/pages/Robots/Hex.tsx': `// Criar robô hex: ${hex}`,
  'src/pages/Robots/Random.tsx': `// Criar robô chave: ${random}`,
  'src/pages/Robots/Legitimate.tsx': `export const route = '${safeRoute}'; export const className = '${safeClass}'; // Criar robô`,
};
for (const value of [encoded, hex, random]) {
  assert.equal(sensitiveKinds(value, { detectOpaque: true }).credential, true, 'sequência opaca deve ser credencial');
  assert.equal(containsSensitiveData(value, { detectOpaque: true }), true);
}
for (const value of [safeRoute, safeClass, files['src/pages/Robots/Legitimate.tsx']]) {
  assert.equal(containsSensitiveData(value, { detectOpaque: true }), false, 'código de interface legítimo deve passar');
}

const base = await realpath(await mkdtemp(join(tmpdir(), 'm530-r4-')));
const checkout = join(base, 'front');
await mkdir(checkout);
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Fixture');
for (const [path, content] of Object.entries(files)) {
  await mkdir(join(checkout, path, '..'), { recursive: true });
  await writeFile(join(checkout, path), content);
}
git('add', '-A');
git('commit', '-qm', 'tracked fixture');
const original = process.env.PRODUCT_LOCAL_CHECKOUT;
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
try {
  const result = await searchLocalProductContext('Criar robô', 'Robôs', { repositoryIds: ['frontend'] });
  assert.equal(result.code[0].available, true, result.code[0].reason);
  assert.deepEqual(result.matches.map(({ path }) => path), ['src/pages/Robots/Legitimate.tsx']);
  const forbidden = [encoded, hex, random, 'Encoded.tsx', 'Hex.tsx', 'Random.tsx'];
  for (const value of forbidden) assert.equal(JSON.stringify(result).includes(value), false, 'segredo não pode chegar ao contexto');
  assert.match(result.matches[0].excerpt, /Criar robô/u);
  let prompt;
  await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Criar robô', module: 'Robôs', description: 'Explicar a tela.' },
    { contextOptions: { repositoryIds: ['frontend'] }, client: { responses: { create: async (request) => {
      prompt = JSON.stringify(request);
      return { model: 'fixture', output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
    } } } });
  assert.ok(prompt);
  for (const value of forbidden) assert.equal(prompt.includes(value), false, 'segredo não pode chegar ao prompt');
} finally {
  if (original === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
  else process.env.PRODUCT_LOCAL_CHECKOUT = original;
}
console.log('M5.30 r4: sequências opacas barradas e código de interface preservado.');
