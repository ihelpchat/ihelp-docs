import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from './journey-runtime.mjs';
import * as server from './server.mjs';
import { fixtureValue } from './journey-service.mjs';
import { qaRequestDecision } from '../scripts/guide-proof.mjs';

const apiOrigin = 'https://qa.example.test';
const target = { url: apiOrigin, local: false };
const env = { GUIDE_QA_ALLOWED_HOSTS: 'qa.example.test' };
const context = { taskId: 'contatos.cadastrar', apiOrigin,
  generated: new Set([fixtureValue('contactName'), fixtureValue('phone')]) };
const request = (url, body = {}, method = 'POST') => ({ url: () => url, method: () => method,
  postData: () => JSON.stringify(body) });
const contact = { nome: fixtureValue('contactName'), contatoTelefones: [
  { numero: fixtureValue('phone').replace(/\D/gu, ''), tipoTelefone: 1 }] };

async function routeOne(input) {
  let blocked = null; let abortedBy = null; let passed = false;
  const denied = {};
  const route = { request: () => input,
    async abort() { abortedBy = 'journey'; },
    async fallback() {
      passed = true;
      if (!qaRequestDecision(input.url(), target, env).allowed) abortedBy = 'network';
    } };
  assert.equal(typeof runtime.handleJourneyRoute, 'function');
  await runtime.handleJourneyRoute(route, { ...context, target, env, thirdPartyDenied: denied,
    onBlocked: (decision) => { blocked = decision; } });
  return { blocked, abortedBy, passed, denied };
}

test('telemetria de terceiro cai no guard de rede sem bloquear a tarefa', async () => {
  const result = await routeOne(request('https://browser-intake-datadoghq.com/api/v2/rum', { appId: 'example' }));
  assert.equal(result.blocked, null);
  assert.equal(result.abortedBy, 'network');
  assert.equal(result.passed, true);
  assert.deepEqual(result.denied, { 'browser-intake-datadoghq.com': 1 });
});

test('POST fora da lista na API de QA bloqueia a tarefa com host e rota sanitizada', async () => {
  const result = await routeOne(request(`${apiOrigin}/api/v2/contacts/42/publish`, contact));
  assert.equal(result.abortedBy, 'journey');
  assert.equal(result.blocked?.host, 'qa.example.test');
  assert.equal(result.blocked?.path, '/contacts/:id/publish');
  assert.equal(result.blocked?.reason, 'rota fora da lista');
});

test('POST de cadastro real na API de QA passa pelo guard', async () => {
  const multipart = `--fixture\r\nContent-Disposition: form-data; name="contato"\r\n\r\n${JSON.stringify(contact)}\r\n--fixture--\r\n`;
  const result = await routeOne({ url: () => `${apiOrigin}/api/v2/contacts`, method: () => 'POST',
    postData: () => multipart });
  assert.equal(result.blocked, null);
  assert.equal(result.abortedBy, null);
  assert.equal(result.passed, true);
});

test('diagnóstico de outro host preserva caminho sem strip de /api/v2', () => {
  const decision = runtime.journeyWriteDecision(request('https://other.example.test/api/v2/rum', {}), context);
  assert.equal(decision.path, '/:id/:id/:id');
  assert.equal(decision.host, 'other.example.test');
  assert.equal(runtime.journeyRequestAllowed(request('https://other.example.test/api/v2/contacts', contact), context), false);
});

test('resposta da ferramenta resume blocked, validation, fixtures e actions sem ids', () => {
  assert.equal(typeof server.journeyTaskSummary, 'function');
  const record = { task: 'contatos.cadastrar', status: 'bloqueada', reason: 'escrita bloqueada pela política',
    blocked: { host: 'qa.example.test', method: 'POST', path: '/contacts', keys: ['nome'], reason: 'valor fora do gerador' },
    fixtures: [{ source: 'GET /api/v2/configurations/users', kind: 'user', ids: [17, 18] }],
    actions: [{ type: 'click' }, { type: 'fill' }] };
  assert.deepEqual(server.journeyTaskSummary(record), {
    task: record.task, status: record.status, reason: record.reason, blocked: record.blocked,
    validation: null, fixtures: [{ source: 'GET /api/v2/configurations/users', kind: 'user', count: 2 }], actions: 2,
    thirdPartyDenied: {},
  });
  assert.equal(server.journeyTaskSummary({ ...record, blocked: null,
    reason: 'validação do formulário: Informe o telefone com DDD' }).validation, 'Informe o telefone com DDD');
});
