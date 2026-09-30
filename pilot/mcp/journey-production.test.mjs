import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedTarget, qaRequestDecision } from '../scripts/guide-proof.mjs';
import { productionConfig, productionPreflight } from './journey-production.mjs';
import { assertProductionAccountHosts, handleJourneyRoute, productionPreflightRequestAllowed,
  recordJourneys } from './journey-runtime.mjs';

const env = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: 'https://front.example.test',
  QA_PROD_ALLOWED_HOSTS: 'front.example.test,api.example.test', QA_PROD_EMAIL: 'qa@example.test',
  QA_PROD_PASSWORD: 'fictional-password' };
const data = { company: { dados: { id: 42, nome: 'Empresa Fictícia' } },
  contacts: { count: 2 }, channels: { dados: [{ idRef: 'channel-1' }] },
  bots: [], automations: { dados: [] }, webhooks: { dados: [] }, connection: { dados: { connected: false } } };
const read = async (path) => path === '/company' ? data.company : path.startsWith('/contacts') ? data.contacts
  : path === '/configurations/channels' ? data.channels : path.startsWith('/channel/connect-status/') ? data.connection
  : path === '/bot' ? data.bots : path === '/automation' ? data.automations
    : path === '/webhook' ? data.webhooks : null;

test('produção requer chave geral e somente hosts explícitos da conta', () => {
  assert.throws(() => productionConfig({ ...env, QA_PROD_ENABLED: 'false' }), /produção desabilitada/u);
  const cfg = productionConfig(env);
  assert.equal(qaRequestDecision('https://front.example.test/', cfg.target, env).allowed, true);
  assert.equal(qaRequestDecision('https://api.example.test/api/v2/company', cfg.target, env).allowed, true);
  assert.equal(qaRequestDecision('https://outro.ihelpchat.com/', cfg.target,
    { ...env, QA_PROD_ALLOWED_HOSTS: `${env.QA_PROD_ALLOWED_HOSTS},outro.ihelpchat.com` }).allowed, false);
  assert.equal(qaRequestDecision('https://terceiro.example.test/', cfg.target, env).allowed, false);
  assert.equal(qaRequestDecision('https://app.ihelpchat.com/', { local: false },
    { GUIDE_QA_ALLOWED_HOSTS: 'app.ihelpchat.com' }).allowed, false);
  assert.throws(() => assertAllowedTarget('https://front.example.test', env), /recusado/u);
  const fixtureEnv = { ...env, QA_PROD_URL: 'https://fixture.ihelpchat.com',
    QA_PROD_ALLOWED_HOSTS: 'fixture.ihelpchat.com,api-fixture.ihelpchat.com' };
  const prodTarget = productionConfig(fixtureEnv).target;
  assert.equal(qaRequestDecision('https://fixture.ihelpchat.com/', prodTarget, fixtureEnv).allowed, true);
  assert.equal(qaRequestDecision('https://fixture.ihelpchat.com/', { local: false },
    { GUIDE_QA_ALLOWED_HOSTS: 'fixture.ihelpchat.com' }).allowed, false);
  assert.equal(qaRequestDecision('https://another-fixture.ihelpchat.com/', prodTarget, fixtureEnv).allowed, false);
  assert.throws(() => productionConfig({ ...fixtureEnv,
    QA_PROD_ALLOWED_HOSTS: 'fixture.ihelpchat.com,another-fixture.ihelpchat.com' }), /hosts de produção/u);
  assert.doesNotThrow(() => assertProductionAccountHosts(prodTarget, 'https://api-fixture.ihelpchat.com'));
  assert.throws(() => assertProductionAccountHosts(prodTarget, 'https://other-api.ihelpchat.com'),
    /hosts da conta divergentes/u);
});

test('sem id confirmado retorna contagens e não chama nenhuma escrita', async () => {
  const paths = [];
  const result = await productionPreflight({ env, identity: { companyId: '42' },
    get: async (path) => { paths.push(path); return read(path); } });
  assert.equal(result.mode, 'confirmacao');
  assert.equal(result.companyId, '42');
  assert.equal(result.companyName, 'Empresa Fictícia');
  assert.deepEqual(result.counts, { contacts: 2, channels: 1, connectedChannels: 0, activeAutomations: 0,
    activeIntegrations: 0 });
  assert.ok(paths.every((path) => path.startsWith('/')));
});

test('id diferente e perigos no pré-voo recusam', async () => {
  await assert.rejects(productionPreflight({ env: { ...env, QA_PROD_COMPANY_ID: '43' },
    identity: { companyId: '42' }, get: read }), /empresa divergente/u);
  for (const [path, payload] of [['/bot', [{ status: true }]],
    ['/webhook', { dados: [{ status: true }] }],
    ['/channel/connect-status/channel-1', { dados: { connected: true } }]]) {
    const result = await productionPreflight({ env: { ...env, QA_PROD_COMPANY_ID: '42' },
      identity: { companyId: '42' }, get: async (entry) => entry === path ? payload : read(entry) });
    assert.equal(result.mode, 'bloqueado', path);
  }
  const missingName = await productionPreflight({ env: { ...env, QA_PROD_COMPANY_ID: '42' },
    identity: { companyId: '42' }, get: async (path) => path === '/company'
      ? { dados: { id: 42 } } : read(path) });
  assert.equal(missingName.mode, 'bloqueado');
});

test('token, GET /company e configuração devem apontar para a mesma empresa', async () => {
  const cfg = { ...env, QA_PROD_COMPANY_ID: '42' };
  await assert.rejects(productionPreflight({ env: cfg, identity: { companyId: '43' }, get: read }),
    /empresa divergente/u);
  await assert.rejects(productionPreflight({ env: cfg, identity: { companyId: '43' },
    get: async (path) => path === '/company' ? { dados: { id: 43, nome: 'Empresa Fictícia' } } : read(path) }),
  /empresa divergente/u);
  assert.equal((await productionPreflight({ env: cfg, identity: { companyId: '42' }, get: read })).mode, 'ready');
});

test('robôs e automações são fontes independentes e qualquer falha recusa', async () => {
  const cfg = { ...env, QA_PROD_COMPANY_ID: '42' };
  const active = await productionPreflight({ env: cfg, identity: { companyId: '42' },
    get: async (path) => path === '/automation' ? { dados: [{ isActive: true }] } : read(path) });
  assert.equal(active.mode, 'bloqueado');
  assert.equal(active.counts.activeAutomations, 1);
  const unavailable = await productionPreflight({ env: cfg, identity: { companyId: '42' },
    get: async (path) => path === '/automation' ? null : read(path) });
  assert.equal(unavailable.mode, 'bloqueado');
});

test('estado desconhecido recusa mesmo com aceite configurado', async () => {
  const cfg = { ...env, QA_PROD_COMPANY_ID: '42' };
  const get = async (path) => path === '/webhook' ? null : read(path);
  assert.equal((await productionPreflight({ env: cfg, identity: { companyId: '42' }, get })).mode, 'bloqueado');
  assert.equal((await productionPreflight({ env: { ...cfg, QA_PROD_ACCEPT_UNVERIFIABLE: 'integrations' },
    identity: { companyId: '42' }, get })).mode, 'bloqueado');
});

test('pré-voo só admite leituras exatas e nega GETs com efeito', () => {
  for (const path of ['/api/v2/company', '/api/v2/automation', '/api/v2/webhook',
    '/api/v2/channel/connect-status/channel-1', '/api/v2/contacts?page=1&limit=1'])
    assert.equal(productionPreflightRequestAllowed('GET', path), true, path);
  for (const path of ['/api/v2/channel/reconnect-all', '/api/v2/channel/disconnect-all',
    '/api/v2/contacts/sync-contacts', '/api/v2/contacts/validate-contacts-business',
    '/api/v2/anything'])
    assert.equal(productionPreflightRequestAllowed('GET', path), false, path);
  assert.equal(productionPreflightRequestAllowed('HEAD', '/api/v2/company'), false);
});

test('runner bloqueia GETs com efeito antes e depois do pré-voo', async () => {
  for (const productionReady of [false, true]) {
    for (const path of ['/api/v2/channel/reconnect-all', '/api/v2/channel/disconnect-all',
      '/api/v2/channel/%72econnect-all', '/api/v2/contacts/sync-contacts',
      '/api/v2/contacts/export', '/api/v2/customers/import-backup',
      '/api/v2/configurations/users/users-connect-sync',
      '/api/v2/vindiCharges/UpdateEmpresaStatus']) {
      let outcome;
      await handleJourneyRoute({ request: () => ({ method: () => 'GET',
        url: () => `https://api.example.test${path}` }), abort: async () => { outcome = 'abort'; },
      fallback: async () => { outcome = 'fallback'; } }, {
        apiOrigin: 'https://api.example.test', target: productionConfig(env).target, env,
        thirdPartyDenied: {}, taskId: 'contatos.cadastrar', productionReady: () => productionReady,
        onBlocked: () => {},
      });
      assert.equal(outcome, 'abort', `${productionReady}: ${path}`);
    }
  }
});

test('modo confirmação encerra antes do runner e da primeira escrita', async () => {
  for (const [method, path] of [['POST', '/api/v2/contacts'], ['PUT', '/api/v2/bot/1/save'],
    ['DELETE', '/api/v2/contacts/1'], ['POST', '/api/v2/configurations/users/login?force=true']])
    assert.equal(productionPreflightRequestAllowed(method, path), false);
  assert.equal(productionPreflightRequestAllowed('POST', '/api/v2/configurations/users/login?force=false'), true);
  let opened = false;
  const result = await recordJourneys('contatos', ['contatos.cadastrar'], { env,
    browser: { async open() { opened = true; } }, preflight: async () => ({ mode: 'confirmacao',
      companyId: '42', companyName: 'Empresa Fictícia', counts: {} }) });
  assert.equal(result.mode, 'confirmacao');
  assert.equal(opened, false);
});

test('guard de escrita permanece fechado antes de confirmar a empresa', async () => {
  let aborted = false;
  await handleJourneyRoute({ request: () => ({ method: () => 'POST',
    url: () => 'https://api.example.test/api/v2/contacts' }),
  abort: async () => { aborted = true; }, fallback: async () => {} }, {
    apiOrigin: 'https://api.example.test', target: productionConfig(env).target, env,
    thirdPartyDenied: {}, taskId: 'contatos.cadastrar', productionReady: () => false,
    onBlocked: () => {},
  });
  assert.equal(aborted, true);
});
