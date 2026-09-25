import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parseGuide, parseAssistantRequest, parseAssistantReply, parseProductAction, resolveGuideId } from '../architecture/conversation-v1.mjs';
import { validateConversationReply } from '../lib/conversation-contract.ts';

const actions = JSON.parse(await readFile(new URL('../architecture/product-actions.json', import.meta.url), 'utf8'));
const fixture = {
  schemaVersion: 1, guideId: 'reconectar-canal-qr', version: 1, mode: 'real', initialStepId: 'abrir-canais',
  steps: [
    { stepId: 'abrir-canais', text: 'Abra Canais.', actionId: 'abrir-canais', choices: [
      { id: 'achei', label: 'Achei', nextStepId: 'confirmar' },
      { id: 'nao-achei', label: 'Não achei', nextStepId: 'confirmar' },
    ] },
    { stepId: 'confirmar', text: 'Confira o estado da conexão.' },
  ],
};
assert.deepEqual(parseGuide(fixture), fixture);
for (const [id, action] of Object.entries(actions)) {
  assert.deepEqual(parseProductAction({ id, ...action }), { id, ...action }, `${id} precisa ter contrato completo`);
}
assert.equal(Object.keys(actions).length, 8);
assert.equal(parseProductAction({ id: 'abrir-canais', ...actions['abrir-canais'] }).target, undefined);

const state = { guideId: fixture.guideId, stepId: fixture.initialStepId, version: 1, mode: 'real', pendingChoiceId: 'achei' };
const request = { schemaVersion: 1, question: 'Como conecto?', guide: state };
const reply = { schemaVersion: 1, answer: 'Abra Canais.', guide: state, actions: [{ id: 'abrir-canais', ...actions['abrir-canais'] }] };
assert.deepEqual(parseAssistantRequest(request), request);
assert.deepEqual(parseAssistantReply(reply), reply);
assert.deepEqual(validateConversationReply(reply), reply, 'cliente aceita a mesma fixture do servidor');

for (const bad of [
  { ...fixture, extra: 'segredo' },
  { ...fixture, steps: [{ ...fixture.steps[0], condition: 'window.location.href="/admin"' }, fixture.steps[1]] },
  { ...fixture, steps: [{ ...fixture.steps[0], actionId: 'inventada' }, fixture.steps[1]] },
  { ...fixture, steps: [{ ...fixture.steps[0], choices: [{ id: 'achei', label: 'Achei', nextStepId: 'inexistente' }] }, fixture.steps[1]] },
]) assert.throws(() => parseGuide(bad));
assert.throws(() => parseAssistantRequest({ ...request, extra: true }));
assert.throws(() => parseAssistantRequest({ ...request, guide: { ...state, stepId: 'invalido', condition: 'true' } }));
for (const bad of [
  { ...reply, extra: true },
  { ...reply, actions: [{ id: 'inventada', label: 'Inventada', route: '/admin' }] },
]) {
  assert.throws(() => parseAssistantReply(bad));
  assert.throws(() => validateConversationReply(bad));
}
assert.deepEqual(parseAssistantReply({ ...reply, actions: [{ ...reply.actions[0], target: 'inventado' }] }).actions, reply.actions, 'target vem do catálogo');
assert.equal(resolveGuideId('abrir-canais'), null, 'alias ambíguo só navega');
assert.equal(resolveGuideId('importar-contatos'), null, 'alias ambíguo só navega');
assert.equal(resolveGuideId('reconectar-canal-qr'), 'reconectar-canal-qr');
assert.equal(resolveGuideId('desconhecido'), null);
execFileSync(process.execPath, ['scripts/generate-conversation-types.mjs', '--check'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
console.log('Contrato v1: servidor, cliente, oito ações, rejeições, aliases e tipos gerados passaram.');
