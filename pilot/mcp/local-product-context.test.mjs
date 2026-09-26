import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLocalProductContext } from './local-product-context.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';

const base = await mkdtemp(join(tmpdir(), 'm530-'));
const checkout = join(base, 'front');
await mkdir(checkout);
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Fixture');
const files = {
  'src/pages/Robots/index.tsx': 'export function Robots() { return <button>Criar robô de atendimento</button>; }',
  'src/pages/ChannelConnection/index.tsx': 'export function ChannelConnection() { return <button>Reconectar canal pelo QR Code</button>; }',
  'src/pages/TabDepartment/index.tsx': 'export function TabDepartment() { return <button>Configurar horário de funcionamento</button>; }',
  'src/pages/Contacts/index.tsx': 'export function Contacts() { return <button>Importar contatos</button>; }',
  '.env': 'Criar robô de atendimento fixture-credential',
  'src/private/credentials.ts': 'Criar robô de atendimento credential-file-marker',
  'src/data/customer.ts': 'export const x = "Criar robô de atendimento operational marker";',
};
for (let index = 0; index < 75; index += 1) files[`src/components/AttendanceChat${index}.tsx`] = 'export const AttendanceChat = "atendimento";';
for (const [path, content] of Object.entries(files)) {
  await mkdir(join(checkout, path, '..'), { recursive: true });
  await writeFile(join(checkout, path), content);
}
const outside = join(base, 'outside.tsx');
await writeFile(outside, 'export const stolen = "Criar robô de atendimento external marker";');
await symlink(outside, join(checkout, 'src/pages/Outside.tsx'));
await symlink(checkout, join(base, 'link'));
git('add', '-A');
git('commit', '-qm', 'fixture');
const sha = git('rev-parse', 'HEAD');
const source = { repository: 'ihelpchat/front-react', root: checkout, sha, role: 'frontend' };

for (const [topic, expected] of [
  ['Criar robô de atendimento', 'src/pages/Robots/index.tsx'],
  ['Reconectar canal pelo QR Code', 'src/pages/ChannelConnection/index.tsx'],
  ['Configurar horário de funcionamento', 'src/pages/TabDepartment/index.tsx'],
]) {
  const result = await searchLocalProductContext(topic, '', { checkouts: [source] });
  assert.equal(result.code[0].available, true, result.code[0].reason);
  assert.equal(result.matches[0]?.path, expected, `implementação causal para ${topic}`);
  assert.equal(result.matches[0]?.sha, sha);
  assert.ok(result.matches[0]?.line > 0);
  assert.doesNotMatch(JSON.stringify(result), /fixture-credential|credential-file-marker|operational marker|external marker|\.env|Outside\.tsx/);
}
const wrongSha = await searchLocalProductContext('Criar robô de atendimento', '', { checkouts: [{ ...source, sha: '0'.repeat(40) }] });
assert.equal(wrongSha.code[0].available, false);
assert.deepEqual(wrongSha.matches, []);
const missing = await searchLocalProductContext('Criar robô de atendimento', '', { checkouts: [{ ...source, root: join(base, 'missing') }] });
assert.equal(missing.code[0].available, false);
assert.deepEqual(missing.matches, []);
const escaped = await searchLocalProductContext('Criar robô de atendimento', '', { checkouts: [{ ...source, root: join(base, 'link') }] });
assert.equal(escaped.code[0].available, false);
const context = await getIhelpContext(new URL('../', import.meta.url).pathname, 'Criar robô de atendimento', 'Robôs', { checkouts: [source] });
assert.equal(context.matches[0]?.path, 'src/pages/Robots/index.tsx');

const request = { topic: 'Criar robô de atendimento', module: 'Robôs', description: 'Explicar a tela.' };
const noModel = { responses: { create: async () => { throw new Error('modelo não pode ser chamado'); } } };
for (const checkouts of [[], [{ ...source, sha: '0'.repeat(40) }]]) {
  const options = { client: noModel, contextOptions: { checkouts } };
  const plan = await planContent(new URL('../', import.meta.url).pathname, request, options);
  assert.equal(plan.status, 'needs_information', 'fonte ausente impede plano pronto');
  const packageResult = await generateContentPackage(new URL('../', import.meta.url).pathname, request, { ...options, plan: { status: 'ready' } });
  assert.equal(packageResult.status, 'needs_information', 'plano antigo não contorna fonte ausente');
  assert.deepEqual(packageResult.articles, []);
}
console.log('M5.30: busca local, SHA, segurança e fail closed passaram.');
