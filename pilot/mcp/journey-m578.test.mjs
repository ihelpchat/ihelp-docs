import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureValue, plannedJourneyAction } from './journey-service.mjs';
import { verifyUniqueRecord } from './journey-runtime.mjs';

const ref = 'owned-ref';
const title = fixtureValue('robotName');
const menu = { idRef: 'menu-ref', type: 1, message: fixtureValue('menuQuestion'), botReactionRules: [
  { message: fixtureValue('menuOption', 1), botEventRedirectRef: 'one-ref' },
  { message: fixtureValue('menuOption', 2), botEventRedirectRef: 'two-ref' }] };
const forward = { idRef: 'forward-ref', type: 4, configuration: JSON.stringify({ DepartmentId: 2 }) };
const page = (labels = []) => ({ url: () => `https://qa.example.test/bot/${ref}`, async goto() {}, async reload() {},
  getByText: (value) => ({ count: async () => Number(value === title || labels.includes(value)) }) });
const verify = (id, events, labels = [], extra = {}) => verifyUniqueRecord({ page: page(labels),
  task: { id, modulo: 'robos' }, refs: [ref], targetUrl: 'https://qa.example.test', name: title,
  expectedValue: title, fixtureIds: { department: new Set([2]), user: new Set([3]) },
  getPersisted: async () => ({ status: 200, body: { dados: { id: 4, idRef: ref, title, status: false, botEvents: events } } }),
  ...extra });

test('menu exige pergunta, duas opções do gerador e destinos existentes', async () => {
  const events = [menu, { idRef: 'one-ref', type: 0 }, { idRef: 'two-ref', type: 0 }];
  assert.equal((await verify('robos.montar_menu', events, ['Menu de opções'])).confirmed, true);
  assert.equal((await verify('robos.montar_menu', [{ ...menu, message: 'Outro texto' }, ...events.slice(1)], ['Menu de opções'])).observed,
    'menu: mensagem');
  assert.equal((await verify('robos.montar_menu', [menu, events[1]], ['Menu de opções'])).observed,
    'menu: destino');
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
