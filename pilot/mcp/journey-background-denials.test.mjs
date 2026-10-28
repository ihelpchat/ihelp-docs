import test from 'node:test';
import assert from 'node:assert/strict';
import { handleJourneyRoute } from './journey-runtime.mjs';
import { productionConfig } from './journey-production.mjs';

const env = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true',
  QA_PROD_URL: 'https://front.example.test',
  QA_PROD_ALLOWED_HOSTS: 'front.example.test,api.example.test',
  QA_PROD_EMAIL: 'qa@example.test', QA_PROD_PASSWORD: 'fixture-password' };
const target = productionConfig(env).target;
const background = [
  ['/api/v2/notifications/sse/connect', 'eventsource'],
  ['/api/v2/crm/sse/connect', 'eventsource'],
  ['/api/v2/sync/calls', 'xhr'],
  ['/api/v2/sync/basic-infos', 'xhr'],
];

async function guard(path, type, { method = 'GET', ready = true, report = true } = {}) {
  const blocked = []; const denied = []; const outcomes = [];
  await handleJourneyRoute({ request: () => ({
    url: () => `https://api.example.test${path}?access_token=fixture-secret`,
    method: () => method, resourceType: () => type, postData: () => '{}',
  }), abort: async () => { outcomes.push('abort'); },
  fallback: async () => { outcomes.push('fallback'); } }, {
    target, env, apiOrigin: 'https://api.example.test', thirdPartyDenied: {},
    taskId: 'contatos.cadastrar', productionReady: () => ready,
    onBlocked: (decision) => { blocked.push(decision); },
    ...(report ? { onBackgroundDenied: (decision) => { denied.push(decision); } } : {}),
  });
  return { blocked, denied, outcomes };
}

for (const [path, type] of background) {
  test(`GET automático ${path} continua abortado sem contaminar a ação da jornada`, async () => {
    const result = await guard(path, type);
    assert.deepEqual(result.outcomes, ['abort']);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(result.denied, [{ method: 'GET', path, reason: 'GET com efeito negado' }]);
    assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  });
}

test('negação automática exige diagnóstico explícito e mantém fail closed nos callers antigos', async () => {
  const result = await guard(background[0][0], 'eventsource', { report: false });
  assert.deepEqual(result.outcomes, ['abort']);
  assert.equal(result.blocked[0]?.reason, 'GET com efeito negado');
  assert.deepEqual(result.denied, []);
});

test('GETs de ação e caminhos parecidos continuam bloqueando a tarefa', async () => {
  for (const path of ['/api/v2/contacts/export', '/api/v2/bot/opencall-contacts',
    '/api/v2/sync/calls/extra', '/api/v2/crm/card/sync']) {
    const result = await guard(path, 'xhr');
    assert.deepEqual(result.outcomes, ['abort']);
    assert.equal(result.blocked[0]?.reason, 'GET com efeito negado');
    assert.deepEqual(result.denied, []);
  }
});

test('SSE com tipo incorreto, HEAD e POST não recebem tratamento de tráfego automático', async () => {
  for (const options of [{ type: 'xhr' }, { type: 'eventsource', method: 'HEAD' },
    { type: 'eventsource', method: 'POST' }]) {
    const result = await guard(background[0][0], options.type, options);
    assert.deepEqual(result.outcomes, ['abort']);
    assert.equal(result.blocked.length, 1);
    assert.deepEqual(result.denied, []);
  }
});

test('GET automático antes do pré-voo continua abortado e reportado sem contaminar a ação', async () => {
  for (const [path, type] of background) {
    const result = await guard(path, type, { ready: false });
    assert.deepEqual(result.outcomes, ['abort']);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(result.denied, [{ method: 'GET', path, reason: 'GET com efeito negado' }]);
  }
});

test('pré-voo continua obrigatório para POST, HEAD, GET desconhecido e caller sem diagnóstico', async () => {
  for (const [path, type, options] of [
    [background[0][0], 'eventsource', { method: 'POST' }],
    [background[0][0], 'eventsource', { method: 'HEAD' }],
    ['/api/v2/bot/opencall-contacts', 'xhr', {}],
    [background[0][0], 'eventsource', { report: false }],
  ]) {
    const result = await guard(path, type, { ...options, ready: false });
    assert.deepEqual(result.outcomes, ['abort']);
    assert.equal(result.blocked[0]?.reason, 'pré-voo ausente');
    assert.deepEqual(result.denied, []);
  }
});

test('leitura permitida permanece livre de negações', async () => {
  const result = await guard('/api/v2/company', 'xhr');
  assert.deepEqual(result, { outcomes: ['fallback'], blocked: [], denied: [] });
});
