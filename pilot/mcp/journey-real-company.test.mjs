import test from 'node:test';
import assert from 'node:assert/strict';
import * as production from './journey-production.mjs';
import * as service from './journey-service.mjs';
import * as runtime from './journey-runtime.mjs';
import { screenshotForStep } from './screen-capture-manifest.mjs';

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const base = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: 'https://front.example.test/',
  QA_PROD_ALLOWED_HOSTS: 'front.example.test,api.example.test', QA_PROD_EMAIL: 'test@example.test',
  QA_PROD_PASSWORD: 'fictional', QA_PROD_COMPANY_ID: '42', QA_PROD_TEST_PHONE: '+44 20 7946 0001' };
const counts = { channels: 2, automations: 2, integrations: 2 };
const attestation = (changes = {}) => JSON.stringify({ data: today, empresa: '42', aceiteEmpresaReal: true,
  limites: { automacoes: 2, integracoes: 2, canaisConectados: 2 }, ...changes });
const get = async (path) => path === '/company' ? { dados: { id: 42, nome: 'Empresa Exemplo' } }
  : path.startsWith('/contacts') ? { count: 1 }
    : path === '/configurations/channels' ? { dados: [
      { idRef: 'canal-a', connected: true }, { idRef: 'canal-b', connected: true }] }
      : path.startsWith('/channel/connect-status/') ? { dados: { connected: true } }
        : path === '/bot' ? []
          : path === '/automation' ? { dados: [{ isActive: true }, { isActive: true }] }
            : path === '/webhook' ? { dados: [{ status: true }, { status: true }] } : null;
const check = (env, reader = get) => production.productionPreflight({ env, identity: { companyId: '42' }, get: reader });

test('aceite recente e contagens dentro dos limites habilitam empresa real; padrão permanece bloqueado', async () => {
  assert.equal((await check(base)).mode, 'bloqueado');
  const ready = await check({ ...base, QA_PROD_OWNER_ATTESTATION: attestation() });
  assert.equal(ready.mode, 'ready');
  assert.equal(ready.realCompany, true);
  assert.deepEqual(ready.counts.activeAutomations, counts.automations);
  assert.equal(ready.counts.activeIntegrations, counts.integrations);
  assert.equal(ready.counts.connectedChannels, counts.channels);
});

test('aceite recusa formato, prazo, empresa divergente, limite excedido e fonte incerta', async () => {
  for (const raw of ['{', attestation({ data: daysAgo(8) }), attestation({ empresa: '43' }),
    attestation({ aceiteEmpresaReal: false }), attestation({ limites: { automacoes: 1, integracoes: 2, canaisConectados: 2 } }),
    attestation({ limites: { automacoes: 2, integracoes: 1, canaisConectados: 2 } }),
    attestation({ limites: { automacoes: 2, integracoes: 2, canaisConectados: 1 } })])
    assert.equal((await check({ ...base, QA_PROD_OWNER_ATTESTATION: raw })).mode, 'bloqueado', raw);
  assert.equal((await check({ ...base, QA_PROD_OWNER_ATTESTATION: attestation() }, async (path) =>
    path === '/automation' ? null : get(path))).mode, 'bloqueado');
  await assert.rejects(check({ ...base, QA_PROD_COMPANY_ID: '43', QA_PROD_OWNER_ATTESTATION: attestation() }), /empresa divergente/u);
});

test('fixtures de empresa real exigem prefixo e telefone do servidor; ações perigosas continuam negadas', () => {
  assert.equal(typeof service.realCompanyFixture, 'function');
  const fixture = (kind) => service.realCompanyFixture(kind, 1, 'abcdef12', base.QA_PROD_TEST_PHONE);
  assert.match(fixture('contactName'), /^Teste FAQ /u);
  assert.equal(fixture('phone'), base.QA_PROD_TEST_PHONE);
  assert.equal(service.policyDecision({ type: 'fill', role: 'textbox', name: 'Nome', value: 'Contato Exemplo 01' },
    new Set([fixture('contactName'), fixture('phone')]), 'contatos.cadastrar', { realCompany: true }).allowed, false);
  assert.equal(service.policyDecision({ type: 'fill', role: 'textbox', name: 'Telefone', value: fixture('phone') },
    new Set([fixture('contactName'), fixture('phone')]), 'contatos.cadastrar', { realCompany: true }).allowed, true);
  for (const name of ['Enviar mensagem', 'Agendar envio', 'Publicar', 'Ativar', 'Conectar', 'Desconectar e entrar'])
    assert.equal(service.policyDecision({ type: 'click', role: 'button', name }, new Set(), '', { realCompany: true }).allowed, false);
});

test('limpeza só usa ids de respostas da execução e relata pendências', async () => {
  assert.equal(typeof service.cleanupCreatedItems, 'function');
  const deleted = [];
  const result = await service.cleanupCreatedItems([{ kind: 'contact', id: 17 }, { kind: 'contact', id: null },
    { kind: 'robot', id: 23 }], async (item) => { deleted.push(item.id); if (item.id === 23) throw Error('falhou'); });
  assert.deepEqual(deleted, [17, 23]);
  assert.deepEqual(result.deleted.map((item) => item.id), [17]);
  assert.equal(result.pending.length, 2);
});

test('print de lista sem filtro é recusado; print pendente não entra no build', () => {
  assert.equal(typeof runtime.realCompanyScreenshotDecision, 'function');
  assert.equal(runtime.realCompanyScreenshotDecision({ path: '/contacts', url: 'https://front.example.test/contacts',
    searchValue: '' }).allowed, false);
  assert.equal(runtime.realCompanyScreenshotDecision({ path: '/contacts', url: 'https://front.example.test/contacts',
    searchValue: 'Teste FAQ' }).allowed, true);
  assert.equal(runtime.realCompanyScreenshotDecision({ path: '/contact/detail/record', ownItem: true }).allowed, true);
  assert.equal(runtime.realCompanyScreenshotDecision({ path: '/contact/detail/record', ownItem: false }).allowed, false);
  const entry = { page: 'contatos', step: 'criar', source: 'automatic', status: 'approved', aprovacao: 'pendente',
    file: '/img/mcp/contatos/criar.automatic.' + 'a'.repeat(64) + '.png', sha256: 'a'.repeat(64),
    bundleSha: 'b'.repeat(40), alt: 'Tela fictícia' };
  assert.equal(screenshotForStep({ version: 1, entries: [entry] }, 'contatos', 'criar'), null);
});
