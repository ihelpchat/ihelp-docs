import test from 'node:test';
import assert from 'node:assert/strict';
import { handleJourneyRoute } from './journey-runtime.mjs';
import { productionConfig } from './journey-production.mjs';

const env = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: 'https://front.example.test',
  QA_PROD_ALLOWED_HOSTS: 'front.example.test,api.example.test', QA_PROD_EMAIL: 'qa@example.test',
  QA_PROD_PASSWORD: 'fixture-password' };
const target = productionConfig(env).target;

async function guard(href, { method = 'GET', type = 'xhr', ready = false, report = true } = {}) {
  const blocked = []; const preflight = []; const outcomes = [];
  await handleJourneyRoute({ request: () => ({ url: () => href, method: () => method,
    resourceType: () => type, postData: () => JSON.stringify({ secret: 'fixture-secret' }),
  }), abort: async () => { outcomes.push('abort'); },
  fallback: async () => { outcomes.push('fallback'); } }, {
    apiOrigin: 'https://api.example.test', target, env, thirdPartyDenied: {},
    taskId: 'contatos.cadastrar', productionReady: () => ready,
    onBlocked: (decision) => { blocked.push(decision); },
    ...(report ? { onPreflightDenied: (decision) => { preflight.push(decision); } } : {}),
  });
  return { blocked, preflight, outcomes };
}

for (const [method, type, href] of [
  ['GET', 'xhr', 'https://api.example.test/api/v2/contacts?page=1&limit=20&token=fixture-secret'],
  ['POST', 'fetch', 'https://api.example.test/api/v2/startup/blocked'],
  ['DELETE', 'fetch', 'https://api.example.test/api/v2/contacts/unrelated-99'],
  ['GET', 'other', 'https://front.example.test/favicon.ico?token=fixture-secret'],
]) {
  test(`inicialização ${method}/${type} continua abortada e não contamina a ação futura`, async () => {
    const result = await guard(href, { method, type });
    assert.deepEqual(result.outcomes, ['abort']);
    assert.deepEqual(result.blocked, []);
    assert.deepEqual(result.preflight, [{ reason: 'pré-voo ausente', method, resourceType: type }]);
    assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
    assert.equal(JSON.stringify(result.preflight).includes('unrelated-99'), false);
  });
}

test('diagnóstico de inicialização normaliza método e tipo desconhecidos sem registrar o valor bruto', async () => {
  const result = await guard('https://api.example.test/api/v2/startup/blocked',
    { method: 'PRIVATE-SECRET', type: 'fixture-secret' });
  assert.deepEqual(result.outcomes, ['abort']);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.preflight, [{ reason: 'pré-voo ausente', method: 'OTHER', resourceType: 'other' }]);
});

test('caller sem diagnóstico de inicialização mantém o bloqueio antigo', async () => {
  const result = await guard('https://api.example.test/api/v2/startup/blocked', { report: false });
  assert.deepEqual(result.outcomes, ['abort']);
  assert.equal(result.blocked[0]?.reason, 'pré-voo ausente');
  assert.deepEqual(result.preflight, []);
});

test('depois do pré-voo, callback não esconde escrita ou GET de ação proibida', async () => {
  for (const [method, path] of [['POST', '/api/v2/startup/blocked'], ['DELETE', '/api/v2/contacts/unrelated-99'],
    ['GET', '/api/v2/contacts/export']]) {
    const result = await guard(`https://api.example.test${path}`, { method, ready: true });
    assert.deepEqual(result.outcomes, ['abort']);
    assert.equal(result.blocked.length, 1);
    assert.deepEqual(result.preflight, []);
  }
});

test('leituras e login já permitidos no pré-voo continuam permitidos sem diagnóstico de negação', async () => {
  for (const [method, path] of [['GET', '/api/v2/company'], ['GET', '/api/v2/contacts?page=1&limit=1'],
    ['POST', '/api/v2/configurations/users/login?force=false']]) {
    const result = await guard(`https://api.example.test${path}`, { method, type: 'fetch' });
    assert.deepEqual(result, { blocked: [], preflight: [], outcomes: ['fallback'] });
  }
});
