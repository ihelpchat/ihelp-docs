import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllowedSourcePath, searchLocalProductContext } from './local-product-context.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { generateContentPackage, planContent, validateGroundedOutput } from './content-ai-service.mjs';

const base = await realpath(await mkdtemp(join(tmpdir(), 'm530-')));
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
  'src/auth/my-token.ts': 'Criar robô de atendimento token-file-marker',
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
await symlink(base, join(base, 'ancestor'));
await symlink(join(checkout, 'src/pages'), join(checkout, 'src/linked-pages'));
git('add', '-A');
git('add', '-f', '.env');
git('commit', '-qm', 'fixture');
const sha = git('rev-parse', 'HEAD');
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
const source = { repository: 'ihelpchat/front-react', root: checkout, sha, role: 'frontend' };
assert.equal(isAllowedSourcePath('.env'), false, '.env não pode sequer ser elegível para leitura');
assert.equal(isAllowedSourcePath('src/data/customer.ts'), false);
assert.equal(isAllowedSourcePath('src/auth/my-token.ts'), false);

for (const [topic, expected] of [
  ['Criar robô de atendimento', 'src/pages/Robots/index.tsx'],
  ['Reconectar canal pelo QR Code', 'src/pages/ChannelConnection/index.tsx'],
  ['Configurar horário de funcionamento', 'src/pages/TabDepartment/index.tsx'],
]) {
  const result = await searchLocalProductContext(topic, '', { repositoryIds: ['frontend'] });
  assert.equal(result.code[0].available, true, result.code[0].reason);
  assert.equal(result.matches[0]?.path, expected, `implementação causal para ${topic}`);
  assert.equal(result.matches[0]?.sha, sha);
  assert.ok(result.matches[0]?.line > 0);
  assert.doesNotMatch(JSON.stringify(result), /fixture-credential|credential-file-marker|token-file-marker|operational marker|external marker|\.env|Outside\.tsx/);
}
const ignoredSha = await searchLocalProductContext('Criar robô de atendimento', '', { repositoryIds: ['frontend'], checkouts: [{ ...source, sha: '0'.repeat(40) }] });
assert.equal(ignoredSha.code[0].available, true, 'SHA do chamador não controla a fonte');
assert.equal(ignoredSha.matches[0]?.sha, sha);
const rejectedRoot = await searchLocalProductContext('Criar robô de atendimento', '', { repositoryIds: ['frontend'], checkouts: [{ ...source, root: join(base, 'missing') }] });
assert.equal(rejectedRoot.matches[0]?.sha, sha, 'raiz do chamador não controla a fonte');
delete process.env.PRODUCT_LOCAL_CHECKOUT;
const callerOnly = await searchLocalProductContext('Criar robô de atendimento', '', { repositoryIds: ['frontend'], checkouts: [source] });
assert.equal(callerOnly.code[0].available, false, 'checkout fora da configuração do servidor é rejeitado');
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
const unknown = await searchLocalProductContext('Criar robô de atendimento', '', { repositoryIds: ['unlisted'] });
assert.equal(unknown.code[0].available, false, 'ID fora da lista fechada é rejeitado');
process.env.PRODUCT_LOCAL_CHECKOUT = join(base, 'link');
const escaped = await searchLocalProductContext('Criar robô de atendimento', '', { repositoryIds: ['frontend'] });
assert.equal(escaped.code[0].available, false);
process.env.PRODUCT_LOCAL_CHECKOUT = join(base, 'ancestor/front');
const escapedAncestor = await searchLocalProductContext('Criar robô de atendimento', '', { repositoryIds: ['frontend'] });
assert.equal(escapedAncestor.code[0].available, false, 'symlink ancestral é rejeitado');
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
const context = await getIhelpContext(new URL('../', import.meta.url).pathname, 'Criar robô de atendimento', 'Robôs', { repositoryIds: ['frontend'] });
assert.equal(context.matches[0]?.path, 'src/pages/Robots/index.tsx');
const citation = { repository: 'ihelpchat/front-react', path: 'src/pages/Robots/index.tsx', lineStart: context.matches[0].line, lineEnd: context.matches[0].line, sha };
assert.equal(validateGroundedOutput({ guidance: 'Clique em Criar robô.', grounding: [{ text: 'Clique em Criar robô.', citations: [citation] }] }, context, ['guidance']), true);
assert.equal(validateGroundedOutput({ guidance: 'Clique em Criar robô.', grounding: [] }, context, ['guidance']), false, 'ready sem citação');
assert.equal(validateGroundedOutput({ guidance: 'Clique em Criar robô.', grounding: [{ text: 'Clique em Criar robô.', citations: [{ ...citation, lineStart: 999, lineEnd: 999 }] }] }, context, ['guidance']), false, 'linha inexistente');
const fakeModel = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({ status: 'ready', guidance: 'Clique em Criar robô.', questions: [], risks: [], suggestedActions: [], grounding: [] }) }) } };
const unguided = await planContent(new URL('../', import.meta.url).pathname, { topic: 'Criar robô de atendimento', module: 'Robôs', description: 'Explicar a tela.' }, { client: fakeModel, contextOptions: { repositoryIds: ['frontend'] } });
assert.equal(unguided.status, 'needs_evidence');
const fakeBin = join(base, 'fake-bin');
await mkdir(fakeBin);
await writeFile(join(fakeBin, 'rg'), '#!/bin/sh\nsleep 10\n');
await chmod(join(fakeBin, 'rg'), 0o755);
const oldPath = process.env.PATH;
process.env.PATH = `${fakeBin}:${oldPath}`;
try {
  const timedOut = await searchLocalProductContext('Criar robô de atendimento', '', { repositoryIds: ['frontend'] });
  assert.equal(timedOut.code[0].available, false, 'rg sem timeout não pode travar a busca');
  assert.match(timedOut.code[0].reason, /tempo|timeout/i);
} finally { process.env.PATH = oldPath; }

const request = { topic: 'Criar robô de atendimento', module: 'Robôs', description: 'Explicar a tela.' };
const noModel = { responses: { create: async () => { throw new Error('modelo não pode ser chamado'); } } };
for (const repositoryIds of [[], ['unknown']]) {
  const options = { client: noModel, contextOptions: { repositoryIds } };
  const plan = await planContent(new URL('../', import.meta.url).pathname, request, options);
  assert.equal(plan.status, 'needs_information', 'fonte ausente impede plano pronto');
  const packageResult = await generateContentPackage(new URL('../', import.meta.url).pathname, request, { ...options, plan: { status: 'ready' } });
  assert.equal(packageResult.status, 'needs_information', 'plano antigo não contorna fonte ausente');
  assert.deepEqual(packageResult.articles, []);
}
console.log('M5.30: busca local, SHA, segurança e fail closed passaram.');
