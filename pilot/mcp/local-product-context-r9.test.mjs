import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLocalProductContext } from './local-product-context.mjs';
import { planContent } from './content-ai-service.mjs';
import { sensitiveKinds } from './sensitive-data.mjs';

const tokens = ['AbCdEfGhIjKlMnOpQrStUvWxYzAbCdE=', 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdE+'];
for (const token of tokens) {
  assert.equal(token.length, 32);
  assert.equal(sensitiveKinds(token, { detectOpaque: true }).credential, true,
    'base64 sem dígitos deve ser barrado');
}

const checkout = await realpath(await mkdtemp(join(tmpdir(), 'm530-r9-back-')));
const files = {
  'Comzada.Application/Controllers/V2/ChannelController.cs':
    `// Reconectar QR ${tokens[0]}\npublic class ChannelController { public void ReconnectQr() {} }`,
  'Comzada.Application/Controllers/V2/ChannelPlusController.cs':
    `// Reconectar QR ${tokens[1]}\npublic class ChannelPlusController { public void ReconnectQr() {} }`,
  'Comzada.Application/Controllers/V2/SafeChannelController.cs':
    'public class SafeChannelController { public void ReconnectQr() {} }',
};
for (const [path, content] of Object.entries(files)) {
  await mkdir(join(checkout, path, '..'), { recursive: true });
  await writeFile(join(checkout, path), content);
}
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' });
git('init', '-q');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'user.name', 'Fixture');
git('add', '-A');
git('commit', '-qm', 'r9 fixture');
const previous = process.env.BACKEND_LOCAL_CHECKOUT;
process.env.BACKEND_LOCAL_CHECKOUT = checkout;
try {
  const context = await searchLocalProductContext('Reconectar QR', 'Canais', { repositoryIds: ['backend'], cache: false });
  assert.equal(context.code[0].available, true, context.code[0].reason);
  assert.ok(context.matches.some(({ path }) => path.endsWith('/SafeChannelController.cs')));
  for (const token of tokens) {
    assert.equal(JSON.stringify(context).includes(token), false, 'token não chega ao excerpt');
  }
  let prompt;
  await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Reconectar QR', module: 'Canais', description: 'Explicar reconexão.' },
    { contextOptions: { repositoryIds: ['backend'] }, client: { responses: { create: async (request) => {
      prompt = JSON.stringify(request);
      return { model: 'fixture', output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
    } } } });
  assert.ok(prompt);
  for (const token of tokens) assert.equal(prompt.includes(token), false, 'token não chega ao prompt');
} finally {
  if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
  else process.env.BACKEND_LOCAL_CHECKOUT = previous;
}
