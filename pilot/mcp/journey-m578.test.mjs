import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureValue, plannedJourneyAction, realCompanyFixture } from './journey-service.mjs';
import { verifyUniqueRecord } from './journey-runtime.mjs';

const ref = 'owned-ref';
const title = fixtureValue('robotName');
const menu = { idRef: 'menu-ref', type: 1, message: fixtureValue('menuQuestion'), botReactionRules: [
  { message: fixtureValue('menuOption', 1), botEventRedirectRef: 'one-ref' },
  { message: fixtureValue('menuOption', 2), botEventRedirectRef: 'two-ref' }] };
const forward = { idRef: 'forward-ref', type: 4, configuration: JSON.stringify({ DepartmentId: 2 }) };
const beforeSave = '2026-09-30T12:00:00.000Z';
const afterSave = '2026-09-30T12:00:02.000Z';
const page = (labels = []) => ({ url: () => `https://qa.example.test/bot/${ref}`, async goto() {}, async reload() {},
  getByText: (value) => ({ count: async () => Number(value === title || labels.includes(value)) }) });
const verify = (id, events, labels = [], extra = {}) => verifyUniqueRecord({ page: page(labels),
  task: { id, modulo: 'robos' }, refs: [ref], targetUrl: 'https://qa.example.test', name: title,
  expectedValue: title, fixtureIds: { department: new Set([2]), user: new Set([3]) },
  beforeEventRefs: new Set(), saveStatus: 200, beforeLastChange: beforeSave,
  taskStartedAt: Date.parse('2026-09-30T12:00:01.000Z'),
  getPersisted: async () => ({ status: 200, body: { dados: { id: 4, idRef: ref, title, status: false,
    dateLastChange: afterSave, botEvents: events } } }),
  ...extra });

const realFixture = (kind, n = 1) => realCompanyFixture(kind, n, '1234abcd', '+44 20 7946 0001');
const realTitle = realFixture('robotName');
const realMenu = { ...menu, message: realFixture('menuQuestion'), botReactionRules:
  menu.botReactionRules.map((rule, index) => ({ ...rule, message: realFixture('menuOption', index + 1) })) };
const realMessage = { idRef: 'one-ref', type: 0, messages: [{ type: 0, message: realFixture('menuOption', 1) }] };
const verifyReal = (id, events, extra = {}) => verifyUniqueRecord({
  page: { ...page(), getByText: value => ({ count: async () => Number(value === realTitle || value === 'Menu de opções') }) },
  task: { id, modulo: 'robos' }, refs: [ref], targetUrl: 'https://qa.example.test', name: realTitle,
  expectedValue: realTitle, fixtureFor: realFixture, fixtureIds: { department: new Set([2]), user: new Set([3]) },
  beforeEventRefs: new Set(), requiredEventRefs: new Set(['one-ref']), saveStatus: 200,
  beforeLastChange: beforeSave, taskStartedAt: Date.parse('2026-09-30T12:00:01.000Z'),
  getPersisted: async () => ({ status: 200, body: { dados: { id: 4, idRef: ref, title: realTitle, status: false,
    dateLastChange: afterSave, botEvents: events } } }), ...extra,
});

test('menu real reconhece exatamente o catálogo Teste FAQ persistido com destinos válidos', async () => {
  const events = [realMenu, realMessage, { ...realMessage, idRef: 'two-ref' }];
  assert.equal((await verifyReal('robos.montar_menu', events)).confirmed, true);
  assert.equal((await verifyReal('robos.montar_menu', [realMenu, realMessage])).observed, 'menu: destino');
  assert.equal((await verifyReal('robos.montar_menu', events, { saveStatus: 500 })).observed, 'salvar: PUT');
});

test('salvar real reconhece mensagem Teste FAQ e exige os refs desta execução', async () => {
  assert.equal((await verifyReal('robos.salvar', [realMessage])).confirmed, true);
  assert.equal((await verifyReal('robos.salvar', [realMessage], { requiredEventRefs: new Set(['ausente']) })).confirmed, false);
});

test('menu real recusa catálogo legado sem prefixo e texto arbitrário', async () => {
  for (const message of [fixtureValue('menuQuestion'), 'Texto não gerado']) {
    const events = [{ ...realMenu, message }, realMessage, { ...realMessage, idRef: 'two-ref' }];
    assert.equal((await verifyReal('robos.montar_menu', events)).observed, 'menu: mensagem');
  }
});

test('salvar real recusa mensagem legada e telefone mesmo pertencendo a outra fixture', async () => {
  for (const message of [fixtureValue('menuOption', 1), realFixture('phone')]) {
    assert.equal((await verifyReal('robos.salvar', [{ ...realMessage, messages: [{ type: 0, message }] }])).observed, 'salvar: blocos');
  }
});

test('menu exige pergunta, duas opções do gerador e destinos existentes', async () => {
  const events = [menu, { idRef: 'one-ref', type: 0 }, { idRef: 'two-ref', type: 0 }];
  assert.equal((await verify('robos.montar_menu', events, ['Menu de opções'])).confirmed, true);
  assert.equal((await verify('robos.montar_menu', [{ ...menu, message: 'Outro texto' }, ...events.slice(1)], ['Menu de opções'])).observed,
    'menu: mensagem');
  assert.equal((await verify('robos.montar_menu', [menu, events[1]], ['Menu de opções'])).observed,
    'menu: destino');
  const split = [{ ...menu, idRef: 'wrong-message', message: 'Outro texto' },
    { ...menu, idRef: 'wrong-options', botReactionRules: [] }, ...events.slice(1)];
  assert.equal((await verify('robos.montar_menu', split, ['Menu de opções'])).confirmed, false);
});

test('encaminhamento independente exige destino das fixtures', async () => {
  assert.equal((await verify('robos.encaminhar', [forward], ['Encaminhar atendimento'])).confirmed, true);
  assert.equal((await verify('robos.encaminhar', [{ ...forward, configuration: '{"DepartmentId":999}' }],
    ['Encaminhar atendimento'])).observed, 'encaminhamento: destino');
});

test('salvar confirma os blocos criados nesta execução', async () => {
  assert.equal((await verify('robos.salvar', [forward], ['Encaminhar atendimento'],
    { requiredEventRefs: new Set(['forward-ref']) })).confirmed, true);
  assert.equal((await verify('robos.salvar', [forward], ['Encaminhar atendimento'],
    { requiredEventRefs: new Set(['outro-ref']) })).observed, 'salvar: blocos');
  assert.equal((await verify('robos.salvar', [], ['Encaminhar atendimento'])).observed, 'salvar: blocos');
});

test('salvar não confirma PUT 500 mesmo com blocos herdados; exige alteração desta tarefa', async () => {
  const inherited = { requiredEventRefs: new Set(['forward-ref']), beforeEventRefs: new Set(['forward-ref']) };
  assert.equal((await verify('robos.salvar', [forward], ['Encaminhar atendimento'],
    { ...inherited, saveStatus: 500 })).confirmed, false);
  assert.equal((await verify('robos.salvar', [forward], ['Encaminhar atendimento'],
    { ...inherited, getPersisted: async () => ({ status: 200, body: { dados: { id: 4, idRef: ref,
      title, status: false, dateLastChange: beforeSave, botEvents: [forward] } } }) })).confirmed, false);
  assert.equal((await verify('robos.salvar', [forward], ['Encaminhar atendimento'], inherited)).confirmed, true);
});

test('menu e encaminhar não confirmam blocos herdados nem PUT falho', async () => {
  const menuEvents = [menu, { idRef: 'one-ref', type: 0 }, { idRef: 'two-ref', type: 0 }];
  assert.equal((await verify('robos.montar_menu', menuEvents, ['Menu de opções'],
    { beforeEventRefs: new Set(menuEvents.map((event) => event.idRef)) })).confirmed, false);
  assert.equal((await verify('robos.montar_menu', menuEvents, ['Menu de opções'],
    { saveStatus: 500 })).confirmed, false);
  assert.equal((await verify('robos.encaminhar', [forward], ['Encaminhar atendimento'],
    { beforeEventRefs: new Set(['forward-ref']) })).confirmed, false);
  assert.equal((await verify('robos.encaminhar', [forward], ['Encaminhar atendimento'],
    { saveStatus: 500 })).confirmed, false);
});

test('plano de encaminhar abre seleção e adiciona bloco antes de salvar', () => {
  const actions = ['Fluxo de Robô', 'Adicionar bloco', 'Ação', 'Encaminhar atendimento', 'opção 1']
    .map((name) => ({ type: 'click', name, role: name === 'opção 1' ? 'option' : 'button' }));
  const screen = { controls: [{ role: 'button', name: 'Adicionar bloco (cabeçalho)', enabled: true }], fields: [] };
  assert.deepEqual(plannedJourneyAction('robos.encaminhar', screen, actions),
    { type: 'click', role: 'button', name: 'Adicionar bloco (cabeçalho)', value: null });
});

test('encaminhar aceita adicionar bloco no ramo existente do menu', () => {
  const screen = { controls: [{ role: 'button', name: 'Adicionar bloco (cabeçalho)', enabled: true }], fields: [] };
  assert.deepEqual(plannedJourneyAction('robos.encaminhar', screen,
    [{ type: 'click', name: 'Fluxo de Robô' }]),
  { type: 'click', role: 'button', name: 'Adicionar bloco (cabeçalho)', value: null });
});

test('plano de salvar grava o fluxo que contém bloco criado na execução', () => {
  const actions = [{ type: 'click', name: 'Fluxo de Robô' }];
  const screen = { controls: [{ role: 'button', name: 'Salvar', enabled: true }], fields: [] };
  assert.deepEqual(plannedJourneyAction('robos.salvar', screen, actions),
    { type: 'click', role: 'button', name: 'Salvar', value: null });
});
