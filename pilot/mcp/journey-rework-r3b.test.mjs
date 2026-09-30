import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureValue, runJourneys } from './journey-service.mjs';
import * as runtime from './journey-runtime.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { journeyRequestAllowed } = runtime;

const call = (method, path, body) => ({ method: () => method,
  url: () => `https://qa.example.test/api/v2${path}`, postData: () => JSON.stringify(body) });

test('telefone fictício tem DDI britânico, 12 dígitos e varia com o marcador', () => {
  const a = fixtureValue('phone', 1, '00000001');
  const b = fixtureValue('phone', 1, '00000002');
  assert.match(a, /^\+44 20 7946 0\d{3}$/u);
  assert.equal(a.replace(/\D/gu, '').length, 12);
  assert.notEqual(a, b);
  const generated = new Set([fixtureValue('contactName'), a]);
  const body = { nome: fixtureValue('contactName'), contatoTelefones: [
    { numero: a.replace(/\D/gu, ''), tipoTelefone: 1 }] };
  const context = { taskId: 'contatos.cadastrar', generated };
  assert.equal(journeyRequestAllowed(call('POST', '/contacts', body), context), true);
  assert.equal(journeyRequestAllowed(call('POST', '/contacts', { ...body,
    contatoTelefones: [{ numero: '442079460999', tipoTelefone: 1 }] }), context), false);
});

test('IDs vêm de três GETs da conta autenticada e falham fechados', async () => {
  assert.equal(typeof runtime.loadQaFixtureIds, 'function');
  const loadQaFixtureIds = runtime.loadQaFixtureIds;
  const paths = [];
  const get = async (path) => { paths.push(path); return { dados: [{ id: paths.length }] }; };
  const result = await loadQaFixtureIds(get);
  assert.deepEqual(paths, ['/configurations/departments', '/configurations/channels', '/configurations/users']);
  assert.equal(result.fixedIds.department.has(1), true);
  assert.equal(result.fixedIds.channel.has(2), true);
  assert.equal(result.fixedIds.user.has(3), true);
  assert.deepEqual(result.fixtures.map((item) => item.source), paths.map((path) => `GET /api/v2${path}`));
  await assert.rejects(loadQaFixtureIds(async () => ({ dados: [{ id: 'anything' }] })), /IDs de QA inválidos/u);
});

test('robô inativo aceita ids lidos e somente padrões opcionais do formulário', () => {
  const context = { taskId: 'robos.criar', generated: new Set([fixtureValue('robotName')]),
    fixedIds: { department: new Set([2]), channel: new Set([3]) } };
  const body = { title: fixtureValue('robotName'), type: 1, status: false,
    departmentId: 2, botTrigger: 1, botChannels: [{ CanalId: 3 }],
    unavailableOptionMessage: '', numberOfInvalidAnswers: 0, defaultMessagesDelay: 0 };
  assert.equal(journeyRequestAllowed(call('POST', '/bot', body), context), true);
  assert.equal(journeyRequestAllowed(call('POST', '/bot', { ...body, botChannels: [] }), context), true);
  assert.equal(journeyRequestAllowed(call('POST', '/bot', { ...body, defaultMessagesDelay: 4 }), context), false);
  assert.equal(journeyRequestAllowed(call('POST', '/bot', { ...body, status: true }), context), false);
  assert.equal(journeyRequestAllowed(call('POST', '/bot', { ...body, departmentId: 9 }), context), false);
});

test('erro de validação visível encerra a tarefa como falhou', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-validation-'));
  const screen = { title: 'Contatos', path: '/contact', controls: [], fields: [],
    messages: ['Informe o telefone com DDD'], state: {}, screenshot: Buffer.from('masked') };
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [{ id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'Criar',
    resultadoEsperadoObservavel: 'Criado' }], frontSha: 'a'.repeat(40), profile: 'qa',
    root, browser: {
      async open() {}, async observe() { return screen; }, async close() {},
    }, model: { async decide() { return { type: 'finish' }; } } });
    assert.equal(record.status, 'falhou');
    assert.equal(record.reason, 'validação do formulário: Informe o telefone com DDD');
  } finally { await rm(root, { recursive: true, force: true }); }
});
