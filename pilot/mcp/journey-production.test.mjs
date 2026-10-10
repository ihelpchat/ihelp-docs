import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedTarget, qaRequestDecision, qaStaticCdnAllowed, installQaNetworkGuard } from '../scripts/guide-proof.mjs';
import { productionConfig, productionPreflight } from './journey-production.mjs';
import * as runtime from './journey-runtime.mjs';
import { journeyFailureCategory } from './journey-service.mjs';

const { assertProductionAccountHosts, handleJourneyRoute, productionPreflightRequestAllowed,
  recordJourneys, configuredJourneyIdentity, createProductionApiObserver } = runtime;

const env = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: 'https://front.example.test',
  QA_PROD_ALLOWED_HOSTS: 'front.example.test,api.example.test', QA_PROD_EMAIL: 'qa@example.test',
  QA_PROD_PASSWORD: 'fictional-password', QA_PROD_OWNER_ATTESTATION: JSON.stringify({
    date: new Date().toISOString().slice(0, 10), channelIds: ['channel-1'] }) };
const data = { company: { dados: { id: 42, nome: 'Empresa Fictícia' } },
  contacts: { count: 2 }, channels: { dados: [{ idRef: 'channel-1', connected: false }] },
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

test('CDN de interface só aceita GET estático em produção, sem credenciais', async () => {
  const target = productionConfig(env).target;
  const request = (url, method = 'GET', type = 'script', headers = {}) => ({
    url: () => url, method: () => method, resourceType: () => type, headers: () => headers,
  });
  const cdn = 'https://cdn.tiny.cloud/1/no-api-key/tinymce/6/tinymce.min.js';
  assert.equal(qaStaticCdnAllowed(request(cdn), target, env), true);
  assert.equal(qaStaticCdnAllowed(request(cdn), { local: false }, env), false);
  assert.equal(qaStaticCdnAllowed(request(cdn, 'POST'), target, env), false);
  assert.equal(qaStaticCdnAllowed(request(cdn, 'GET', 'fetch'), target, env), false);
  assert.equal(qaStaticCdnAllowed(request(cdn, 'GET', 'script', { authorization: 'Bearer secret' }), target, env), false);
  assert.equal(qaStaticCdnAllowed(request('https://www.googletagmanager.com/gtm.js', 'GET', 'script'), target, env), false);
  let handler;
  const guard = await installQaNetworkGuard({ async route(_pattern, callback) { handler = callback; } }, target, env);
  const run = async (input) => {
    let result;
    await handler({ request: () => input, fetch: async () => ({ headers: () => ({}) }),
      fulfill: async () => { result = 'allowed'; }, abort: async () => { result = 'denied'; } });
    return result;
  };
  assert.equal(await run(request(cdn)), 'allowed');
  assert.equal(await run(request(cdn, 'POST')), 'denied');
  assert.equal(await run(request('https://www.googletagmanager.com/gtm.js')), 'denied');
  assert.equal(guard.blocked.length, 2);
  let homologHandler;
  await installQaNetworkGuard({ async route(_pattern, callback) { homologHandler = callback; } },
    { local: false, url: 'https://qa.example.test' }, { GUIDE_QA_ALLOWED_HOSTS: 'qa.example.test' });
  let homologResult;
  await homologHandler({ request: () => request(cdn),
    abort: async () => { homologResult = 'denied'; } });
  assert.equal(homologResult, 'denied');
  let blocked;
  const denied = {};
  let journeyResult;
  await handleJourneyRoute({ request: () => request(cdn),
    fallback: async () => { journeyResult = 'allowed'; }, abort: async () => { journeyResult = 'denied'; } },
  { target, env, thirdPartyDenied: denied, productionReady: () => false,
    taskId: 'contatos.cadastrar', onBlocked: (value) => { blocked = value; } });
  assert.equal(journeyResult, 'allowed');
  assert.equal(blocked, undefined);
  assert.deepEqual(denied, {});
});

test('requisição sem resposta registra motivo sanitizado da falha', () => {
  const observer = createProductionApiObserver(productionConfig(env).target, env);
  const request = { url: () => 'https://front.example.test/private?token=secret',
    method: () => 'GET', headers: () => ({ authorization: 'Bearer secret' }),
    failure: () => ({ errorText: 'net::ERR_FAILED' }) };
  const guard = { reasons: new WeakMap([[request, { reason: 'bloqueado: pré-voo' }]]) };
  observer.request(request);
  observer.failed(request, guard);
  assert.deepEqual(observer.diagnostic().requests[0], { host: 'front.example.test', path: '/:id',
    method: 'GET', bearer: true, status: null, failure: 'bloqueado: pré-voo' });
  assert.doesNotMatch(JSON.stringify(observer.diagnostic()), /secret|token=/u);
});

test('configuração real de confirmação chega ao login sem rede nem navegador', async () => {
  const confirmationEnv = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true',
    QA_PROD_URL: 'https://app.ihelpchat.com',
    QA_PROD_ALLOWED_HOSTS: 'app.ihelpchat.com,apiv3.ihelpchat.com',
    QA_PROD_EMAIL: 'ficticio@example.test', QA_PROD_PASSWORD: 'senha-ficticia',
    GUIDE_QA_STAGING_URL: 'https://staging.example.test',
    GUIDE_QA_ALLOWED_HOSTS: 'staging.example.test', CAPTURE_AGENT_MODEL: 'mock' };
  let launched = false;
  let loginReached = false;
  const page = { on() {}, url: () => 'https://app.ihelpchat.com/login' };
  const context = { async route() {}, async newPage() { return page; } };
  const result = await recordJourneys('contatos', ['contatos.cadastrar'], {
    env: confirmationEnv,
    preflight: (configured) => runtime.browserProductionPreflight(configured, {
      launchBrowser: async () => { launched = true; return { async newContext() { return context; }, async close() {} }; },
      login: async (_page, baseUrl, credentials) => {
        loginReached = true;
        assert.equal(baseUrl, confirmationEnv.QA_PROD_URL);
        assert.equal(credentials.email, confirmationEnv.QA_PROD_EMAIL);
        throw new Error('login fictício interrompido');
      },
    }),
  });
  assert.equal(launched, true);
  assert.equal(loginReached, true);
  assert.equal(result.mode, 'bloqueado');
  assert.equal(result.reason, 'login');
});

test('API indefinida falha fechada com categoria específica, sem Invalid URL', () => {
  const target = productionConfig(env).target;
  assert.throws(() => assertProductionAccountHosts(target, undefined), (error) =>
    journeyFailureCategory(error) === 'api_nao_detectada' && !/Invalid URL/u.test(error.message));
});

test('diagnóstico do login guarda só host, padrão de caminho, Bearer e status', () => {
  const observer = createProductionApiObserver(productionConfig(env).target, env);
  const bearer = 'Bearer secret-authorization-value';
  const cookie = 'session=secret-cookie-value';
  const request = {
    url: () => 'https://api.example.test/api/v2/contacts/12345?token=secret-query-value',
    method: () => 'GET', headers: () => ({ authorization: bearer, cookie }),
  };
  observer.request(request);
  observer.response({ request: () => request, status: () => 200 });
  observer.loginFinished({ url: () => 'https://front.example.test/contact/98765?cookie=secret-cookie-value' });
  const diagnostic = observer.diagnostic();
  assert.equal(observer.api()?.origin, 'https://api.example.test');
  assert.deepEqual(diagnostic.requests, [{ host: 'api.example.test', path: '/api/v2/contacts/:id',
    method: 'GET', bearer: true, status: 200 }]);
  assert.equal(diagnostic.login.finished, true);
  assert.equal(diagnostic.login.url, 'front.example.test/contact/:id');
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret-|session=|token=|cookie=|Authorization/iu);
});

test('falha 2FA preserva campos e botões sanitizados e bloqueia a confirmação', async () => {
  const target = productionConfig(env).target;
  const observer = createProductionApiObserver(target, env);
  observer.loginFailed({ url: () => 'https://front.example.test/login?token=secret' },
    { code: 'LOGIN_2FA', diagnostic: { outcome: '2fa', fields: [{ role: 'textbox', label: 'Código' }],
      buttons: ['Validar'], links: [], messages: [] } });
  assert.deepEqual(observer.diagnostic().login, { finished: false, url: 'front.example.test/login',
    message: '2FA exigido', fields: [{ role: 'textbox', label: 'Código' }], buttons: ['Validar'], links: [] });
  const result = await runtime.browserProductionPreflight(env, {
    launchBrowser: async () => ({ async newContext() { return { async route() {}, async newPage() {
      return { on() {}, url: () => 'https://front.example.test/login' }; } }; }, async close() {} }),
    login: async () => { throw Object.assign(new Error('Login falhou'), { code: 'LOGIN_2FA' }); },
  });
  assert.equal(result.reason, 'login_2fa');
});

for (const [label, url, headers, status] of [
  ['200 sem Bearer', 'https://api.example.test/api/v2/company', {}, 200],
  ['401 com Bearer no host permitido', 'https://api.example.test/api/v2/company',
    { authorization: 'Bearer secret-authorization-value' }, 401],
  ['200 com Bearer fora da allowlist', 'https://api.other.test/api/v2/company',
    { authorization: 'Bearer secret-authorization-value' }, 200],
]) test(`descoberta recusa ${label}`, () => {
  const observer = createProductionApiObserver(productionConfig(env).target, env);
  const request = { url: () => url, method: () => 'GET', headers: () => headers };
  observer.request(request);
  observer.response({ request: () => request, status: () => status });
  assert.equal(observer.api(), null);
  assert.equal(observer.diagnostic().requests[0].status, status);
});

test('mensagem de login desconhecida não devolve conteúdo potencialmente sensível', () => {
  const observer = createProductionApiObserver(productionConfig(env).target, env);
  observer.loginFailed({ url: () => 'https://front.example.test/login?token=secret-query-value' },
    { diagnostic: { messages: ['Falha: session=secret-cookie-value Bearer secret-authorization-value'] } });
  assert.deepEqual(observer.diagnostic().login, { finished: false, url: 'front.example.test/login',
    message: 'mensagem de login não reconhecida', fields: [], buttons: [], links: [] });
  assert.doesNotMatch(JSON.stringify(observer.diagnostic()), /secret-|session=|Bearer/iu);
});

test('host do front também pode ser API quando recebe resposta Bearer autenticada', () => {
  const target = productionConfig(env).target;
  const observer = createProductionApiObserver(target, env);
  const request = { url: () => 'https://front.example.test/api/v2/company', method: () => 'GET',
    headers: () => ({ authorization: 'Bearer secret-authorization-value' }) };
  observer.request(request);
  observer.response({ request: () => request, status: () => 200 });
  assert.equal(observer.api()?.origin, target.url);
  assert.doesNotThrow(() => assertProductionAccountHosts(target, observer.api()?.origin));
});

test('sem API detectada, gravar_jornada retorna categoria e diagnóstico sem lançar', async () => {
  const diagnostic = { login: { finished: true, url: 'front.example.test/contact', message: null },
    requests: [{ host: 'api.example.test', path: '/api/v2/company', method: 'GET', bearer: false, status: 200 }] };
  const result = await recordJourneys('contatos', ['contatos.cadastrar'], { env,
    preflight: async () => ({ mode: 'bloqueado', reason: 'api_nao_detectada', diagnostic }) });
  assert.equal(result.reason, 'api_nao_detectada');
  assert.deepEqual(result.diagnostic, diagnostic);
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

test('canais só ficam prontos quando listagem e status concordam em desconectado', async () => {
  const cfg = { ...env, QA_PROD_COMPANY_ID: '42' };
  const scenarios = [
    ['listagem conectada, status desconectado', '/configurations/channels',
      { dados: [{ idRef: 'channel-1', connected: true }] }, 'divergente'],
    ['listagem desconectada, status conectado', '/channel/connect-status/channel-1',
      { dados: { connected: true } }, 'divergente'],
    ['campo da listagem ausente', '/configurations/channels',
      { dados: [{ idRef: 'channel-1' }] }, 'não verificável'],
    ['campo do status ausente', '/channel/connect-status/channel-1',
      { dados: {} }, 'não verificável'],
    ['status com formato inesperado', '/channel/connect-status/channel-1',
      { dados: { connected: 'false' } }, 'não verificável'],
    ['falha da listagem', '/configurations/channels', null, 'não verificável'],
    ['falha do status', '/channel/connect-status/channel-1', null, 'não verificável'],
  ];
  for (const [name, path, payload, reason] of scenarios) {
    const result = await productionPreflight({ env: cfg, identity: { companyId: '42' },
      get: async (entry) => entry === path ? payload : read(entry) });
    assert.equal(result.mode, 'bloqueado', name);
    assert.match(result.reason, new RegExp(reason, 'u'), name);
    assert.equal(result.counts.connectedChannels, 'não verificável', name);
    assert.deepEqual(Object.keys(result).sort(), ['counts', 'mode', 'reason'], name);
  }
  const ready = await productionPreflight({ env: cfg, identity: { companyId: '42' }, get: read });
  assert.equal(ready.mode, 'ready');
  assert.equal(ready.counts.connectedChannels, 0);
});

test('SDK fora nas duas fontes só libera com atestado recente e exato do dono', async () => {
  const cfg = { ...env, QA_PROD_COMPANY_ID: '42' };
  const preflight = (attestation, get = read) => productionPreflight({
    env: { ...cfg, QA_PROD_OWNER_ATTESTATION: attestation }, identity: { companyId: '42' }, get });
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const signed = (date, channelIds) => JSON.stringify({ date, channelIds });
  for (const attestation of [undefined, '', '{}', signed(daysAgo(8), ['channel-1']),
    signed('2099-01-01', ['channel-1']), signed(today, []), signed(today, ['other-channel']),
    signed(today, ['channel-1', 'other-channel']), signed(today, ['channel-1', 'channel-1']),
    signed(today, ['channel-1']).replace(today, `${today}T00:00:00Z`)]) {
    const result = await preflight(attestation);
    assert.equal(result.mode, 'bloqueado', String(attestation));
  }
  const ready = await preflight(signed(today, ['channel-1']));
  assert.equal(ready.mode, 'ready');
  assert.equal(ready.connectivityAttestation, `conectividade atestada pelo dono em ${today}`);
  assert.equal((await preflight(signed(today, ['channel-1']), async (path) =>
    path === '/channel/connect-status/channel-1' ? { dados: { connected: true } } : read(path))).mode, 'bloqueado');
});

test('hash da homologação preserva a chave dos ponteiros anteriores', () => {
  const cfg = { GUIDE_QA_STAGING_URL: 'https://qa.example.test',
    GUIDE_QA_ALLOWED_HOSTS: 'qa.example.test', GUIDE_QA_AUTHORIZED_EMAIL: 'Qa@example.com',
    GUIDE_QA_AUTHORIZED_PASSWORD: 'fixture-pass' };
  const previousHash = '4f1bb1082393125525afb2e1d0c844283a1e9c307ec82d3e3d170747f8cbe954';
  assert.equal(configuredJourneyIdentity(cfg).credentialHash, previousHash);
  assert.equal(configuredJourneyIdentity({ ...cfg, QA_TARGET: 'homolog' }).credentialHash, previousHash);
});

test('pré-voo só admite leituras exatas e nega GETs com efeito', () => {
  for (const path of ['/mfe-root-config.js?v=1.0.0', '/ihelp-angular/main.js?v=1.0.0',
    '/ihelp-angular/styles.css', '/javascripts/WebAudioRecorder.js'])
    assert.equal(productionPreflightRequestAllowed('GET', path), true, path);
  assert.equal(productionPreflightRequestAllowed('POST', '/ihelp-angular/main.js'), false);
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
      '/api/v2/vindiCharges/UpdateEmpresaStatus',
      '/api/v2/filter/fix-filters-user/1/2',
      '/api/v2/customers/auto-fill-contacts/1',
      '/api/v2/customers/channel-reconection-check',
      '/api/v2/company/subscription-reminder',
      '/api/v2/company/migrate-v3/1',
      '/api/v2/validator/email/user-1',
      '/api/v2/syncclientspayment']) {
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
