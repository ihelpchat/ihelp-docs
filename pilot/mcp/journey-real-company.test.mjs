import test from 'node:test';
import assert from 'node:assert/strict';
import * as production from './journey-production.mjs';
import * as service from './journey-service.mjs';
import * as runtime from './journey-runtime.mjs';
import { screenshotForStep } from './screen-capture-manifest.mjs';
import { chooseScreenshot } from '../scripts/screen-capture/capture.mjs';
import { reviewJourneyPrint } from '../scripts/review-journey-print.mjs';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  assert.equal((await check({ ...base, QA_PROD_OWNER_ATTESTATION: attestation() }, async (path) =>
    path === '/channel/connect-status/canal-a' ? { dados: { connected: false } } : get(path))).mode, 'bloqueado');
  await assert.rejects(check({ ...base, QA_PROD_COMPANY_ID: '43', QA_PROD_OWNER_ATTESTATION: attestation() }), /empresa divergente/u);
});

test('fixtures de empresa real exigem prefixo e telefone do servidor; ações perigosas continuam negadas', () => {
  assert.equal(typeof service.realCompanyFixture, 'function');
  const fixture = (kind) => service.realCompanyFixture(kind, 1, 'abcdef12', base.QA_PROD_TEST_PHONE);
  assert.match(fixture('contactName'), /^Teste FAQ /u);
  assert.equal(fixture('phone'), base.QA_PROD_TEST_PHONE);
  assert.equal(service.policyDecision({ type: 'fill', role: 'textbox', name: 'Nome', value: 'Contato Exemplo 01' },
    new Set([fixture('contactName'), fixture('phone'), 'Contato Exemplo 01']), 'contatos.cadastrar',
    { realCompany: true, testPhone: base.QA_PROD_TEST_PHONE }).allowed, false);
  assert.equal(service.policyDecision({ type: 'fill', role: 'textbox', name: 'Telefone', value: fixture('phone') },
    new Set([fixture('contactName'), fixture('phone')]), 'contatos.cadastrar',
    { realCompany: true, testPhone: base.QA_PROD_TEST_PHONE }).allowed, true);
  assert.equal(service.policyDecision({ type: 'fill', role: 'textbox', name: 'Telefone', value: '00000000000' },
    new Set(['00000000000']), 'contatos.cadastrar',
    { realCompany: true, testPhone: base.QA_PROD_TEST_PHONE }).allowed, false);
  for (const name of ['Enviar mensagem', 'Agendar envio', 'Publicar', 'Ativar', 'Conectar', 'Desconectar e entrar'])
    assert.equal(service.policyDecision({ type: 'click', role: 'button', name }, new Set(), '', { realCompany: true }).allowed, false);
  assert.equal(service.policyDecision({ type: 'click', role: 'button', name: 'Enviar mensagem' }, new Set(),
    'robos.montar_menu', { realCompany: true }).allowed, false);
  assert.equal(runtime.productionPreflightRequestAllowed('POST', '/api/v2/configurations/users/login?force=true'), false);
  const request = (method, path, body = '') => ({ method: () => method,
    url: () => `https://api.example.test/api/v2${path}`, postData: () => body });
  const context = { taskId: 'robos.criar', apiOrigin: 'https://api.example.test', generated: new Set(),
    createdIds: new Set(), fixedIds: {} };
  assert.equal(runtime.journeyRequestAllowed(request('POST', '/channel/connect'), context), false);
  assert.equal(runtime.journeyRequestAllowed(request('POST', '/bot/publish'), context), false);
  assert.equal(runtime.journeyRequestAllowed(request('DELETE', '/bot/created-1'), context), false);
});

test('limpeza só usa ids de respostas da execução e relata pendências', async () => {
  assert.equal(typeof service.cleanupCreatedItems, 'function');
  const deleted = [];
  const result = await service.cleanupCreatedItems([{ kind: 'contact', id: 17 }, { kind: 'contact', id: null },
    { kind: 'robot', id: 23 }], async (item) => { deleted.push(item.id); if (item.id === 23) throw Error('falhou'); });
  assert.deepEqual(deleted, [17, 23]);
  assert.deepEqual(result.deleted.map((item) => item.id), [17]);
  assert.equal(result.pending.length, 2);
  const ids = [{ kind: 'contact', id: 'created-1' }, { kind: 'tag', id: 19 }];
  const api = 'https://api.example.test';
  assert.equal(runtime.cleanupDeleteAllowed('DELETE', `${api}/api/v2/contacts/created-1`, api, ids), true);
  assert.equal(runtime.cleanupDeleteAllowed('DELETE', `${api}/api/v2/tags/19`, api, ids), true);
  for (const [method, href, origin] of [
    ['DELETE', `${api}/api/v2/contacts/other`, api],
    ['DELETE', `${api}/api/v2/contacts/created-1?force=true`, api],
    ['DELETE', 'https://front.example.test/api/v2/contacts/created-1', api],
    ['POST', `${api}/api/v2/contacts/created-1`, api],
  ]) assert.equal(runtime.cleanupDeleteAllowed(method, href, origin, ids), false);
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
  assert.equal(chooseScreenshot({ version: 1, entries: [entry] }, 'contatos', 'criar'), null);
});

test('regente revisa print por id verificado, sem alterar outros registros', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-review-'));
  const dir = join(root, 'contatos');
  const bytes = Buffer.from('print fictício');
  const id = createHash('sha256').update(bytes).digest('hex');
  try {
    await mkdir(dir);
    await writeFile(join(dir, `${id}.png`), bytes);
    await writeFile(join(dir, 'journey.json'), JSON.stringify({ screens: [{ screenshotId: id, aprovacao: 'pendente' }] }));
    assert.deepEqual(await reviewJourneyPrint({ root, screenshotId: id, decision: 'aprovado' }),
      { screenshotId: id, decision: 'aprovado', records: 1 });
    assert.equal(JSON.parse(await readFile(join(dir, 'journey.json'), 'utf8')).screens[0].aprovacao, 'aprovado');
    await assert.rejects(reviewJourneyPrint({ root, screenshotId: id, decision: 'recusado' }), /sem aprovação pendente/u);
    await assert.rejects(reviewJourneyPrint({ root, screenshotId: 'b'.repeat(64), decision: 'aprovado' }),
      /não encontrado/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('jornada real persiste motivo do print omitido e máscara o telefone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-real-'));
  const marker = 'abcdef12';
  const name = service.realCompanyFixture('contactName', 1, marker, base.QA_PROD_TEST_PHONE);
  const phone = base.QA_PROD_TEST_PHONE;
  const actions = [
    { type: 'click', role: 'button', name: 'Adicionar Contato' },
    { type: 'fill', role: 'textbox', name: 'Nome', value: name },
    { type: 'fill', role: 'textbox', name: 'Telefone', value: phone },
    { type: 'click', role: 'button', name: 'Salvar' },
  ];
  let index = 0;
  const browser = { async open() {}, async observe() { return {
    title: 'Contatos', path: '/contact',
    controls: [{ role: 'button', name: 'Adicionar Contato', enabled: true },
      { role: 'button', name: 'Salvar', enabled: true }],
    fields: [{ role: 'textbox', name: 'Nome', required: true, filled: index > 1, value: index > 1 ? name : null },
      { role: 'textbox', name: 'Telefone', required: true, filled: index > 2, value: index > 2 ? phone : null }],
    messages: [], state: {}, screenshot: null, screenshotReason: 'tela sem item próprio ou filtro Teste FAQ comprovado',
  }; }, async act() { index++; }, async awaitCreation() { return { capture: { postSeen: true, status: 201,
    refFound: true }, ref: 'created-1' }; }, async verify() { return { confirmed: true,
      observed: 'Contato fictício localizado', created: { contact: name } }; }, async close() {} };
  try {
    const [record] = await service.runJourneys({ module: 'contatos', tasks: [{ id: 'contatos.cadastrar',
      modulo: 'contatos', tarefa: 'Cadastrar', resultadoEsperadoObservavel: 'Contato fictício localizado' }],
    root, frontSha: 'a'.repeat(40), profile: 'qa', marker, browser, realCompany: true, testPhone: phone,
    cacheConfig: { qaTarget: 'producao' }, model: { async decide() { return actions[index] ?? { type: 'finish' }; } } });
    assert.equal(record.status, 'concluída');
    assert.equal(record.screens[0].screenshotId, null);
    assert.match(record.screens[0].screenshotReason, /filtro Teste FAQ/u);
    const stored = await readFile(join(root, 'contatos', (await readdir(join(root, 'contatos')))
      .find((value) => value.endsWith('.json'))), 'utf8');
    assert.doesNotMatch(stored, new RegExp(phone.replace(/[+()]/gu, '\\$&'), 'u'));
    assert.match(stored, /telefone de teste mascarado/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runner anexa relatório de limpeza ao resultado mesmo se uma jornada falhar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-real-cleanup-'));
  let cleanups = 0;
  const cleanup = { created: [{ kind: 'contact', id: 'created-1' }], deleted: [],
    pending: [{ kind: 'contact', id: 'created-1', reason: 'remoção não confirmada' }] };
  try {
    const records = await runtime.recordJourneys('contatos', ['contatos.cadastrar'], {
      env: { ...base, CAPTURE_FRONT_SHA: 'a'.repeat(40) }, root,
      preflight: async () => ({ mode: 'ready', companyId: '42', realCompany: true,
        ownerAttestation: `empresa real atestada pelo dono em ${today}` }),
      getProductContext: async () => ({ code: [{ role: 'frontend', available: true,
        screenFacts: [{ text: 'Adicionar Contato' }], screenCode: [], ref: 'a'.repeat(40) }] }),
      browser: { async open() { throw Error('falha fictícia'); }, async close() {},
        async cleanupCreated() { cleanups++; return cleanup; } }, model: {},
    });
    assert.equal(cleanups, 1);
    assert.deepEqual(records.cleanup, cleanup);
    assert.equal(JSON.parse(await readFile(join(root,
      (await readdir(root)).find((file) => file.startsWith('cleanup-'))), 'utf8'))
      .pending.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
