import test from 'node:test';
import assert from 'node:assert/strict';
import { qaRequestDecision } from '../scripts/guide-proof.mjs';
import { productionConfig, productionPreflight } from './journey-production.mjs';

const env = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: 'https://front.example.test',
  QA_PROD_ALLOWED_HOSTS: 'front.example.test,api.example.test', QA_PROD_EMAIL: 'qa@example.test',
  QA_PROD_PASSWORD: 'fictional-password' };
const data = { company: { dados: { id: 42, razaoSocial: 'Empresa Fictícia' } },
  contacts: { count: 2 }, channels: { dados: [{ idRef: 'channel-1' }] },
  bots: [], webhooks: { dados: [] }, connection: { dados: { connected: false } } };
const read = async (path) => path === '/company' ? data.company : path.startsWith('/contacts') ? data.contacts
  : path === '/configurations/channels' ? data.channels : path.startsWith('/channel/connect-status/') ? data.connection
  : path === '/bot' ? data.bots : path === '/webhook' ? data.webhooks : null;

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
});

test('estado desconhecido recusa salvo aceite explícito por item', async () => {
  const cfg = { ...env, QA_PROD_COMPANY_ID: '42' };
  const get = async (path) => path === '/webhook' ? null : read(path);
  assert.equal((await productionPreflight({ env: cfg, identity: { companyId: '42' }, get })).mode, 'bloqueado');
  assert.equal((await productionPreflight({ env: { ...cfg, QA_PROD_ACCEPT_UNVERIFIABLE: 'integrations' },
    identity: { companyId: '42' }, get })).mode, 'ready');
});
