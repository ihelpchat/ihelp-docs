import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { fixtureValue, runJourneys } from './journey-service.mjs';
import { journeyTaskSummary } from './server.mjs';
import { actJourneyAction, journeyActionCategory, journeyCreationResponse, observeJourneyDom } from './journey-runtime.mjs';

const task = (id) => ({ id, modulo: id.split('.')[0], tarefa: id });
const frontSha = 'a'.repeat(40);

test('POST de criação confirma a tarefa sem depender de finish e libera dependente', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r9-post-'));
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  const acted = []; let verifies = 0;
  const values = { Nome: null, Telefone: null };
  const browser = {
    async open() {}, async close() {},
    async observe() { return { title: 'Contatos', path: '/contact', controls: [
      { role: 'textbox', name: 'Nome', enabled: true },
      { role: 'textbox', name: 'Telefone', enabled: true },
      { role: 'button', name: 'Salvar', enabled: true },
    ], fields: [{ role: 'textbox', name: 'Nome', value: values.Nome }, { role: 'textbox', name: 'Telefone', value: values.Telefone }],
    messages: [], state: {}, screenshot: Buffer.from('masked') }; },
    async act(action) { acted.push(action); if (action.type === 'fill') values[action.name] = action.value; },
    async awaitCreation() { return { capture: { postSeen: true, status: 200, jsonParsed: true,
      topKeys: ['idRef'], refFound: true }, ref: 'owned-ref' }; },
    async verify() { verifies++; return { confirmed: true, observed: 'Ficha conferida',
      created: { contact: name },
      identity: { refs: ['owned-ref'], ids: [31] } }; },
  };
  const model = { async decide() {
    if (!values.Nome) return { type: 'fill', role: 'textbox', name: 'Nome', value: name };
    if (!values.Telefone) return { type: 'fill', role: 'textbox', name: 'Telefone', value: phone };
    return { type: 'click', role: 'button', name: 'Salvar' }; } };
  try {
    const [record, dependent] = await runJourneys({ module: 'contatos', tasks: [task('contatos.cadastrar'), task('contatos.buscar')],
      root, frontSha, profile: 'qa', browser, model, maxActionsPerTask: 4 });
    assert.equal(record.status, 'concluída');
    assert.equal(verifies, 1);
    assert.equal(record.created.contact, name);
    assert.equal(record.creationCapture.refFound, true);
    assert.notEqual(dependent.reason, 'sem dado de preparo');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Salvar sem POST registra diagnóstico e devolve ao modelo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r9-empty-'));
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  let decisions = 0;
  const browser = { async open() {}, async close() {},
    async observe() { return { title: 'Contatos', path: '/contact', controls: [
      { role: 'textbox', name: 'Nome', enabled: true }, { role: 'textbox', name: 'Telefone', enabled: true },
      { role: 'button', name: 'Salvar', enabled: true }], fields: [
      { role: 'textbox', name: 'Nome', value: name }, { role: 'textbox', name: 'Telefone', value: phone }],
    messages: [], state: {}, screenshot: Buffer.from('masked') }; },
    async act() {}, async awaitCreation() { return { capture: { postSeen: false, status: null,
      jsonParsed: false, topKeys: [], refFound: false }, saveOutcome: 'sem requisição',
    messages: ['Informe o telefone com DDD'] }; } };
  const model = { async decide({ feedback }) { decisions++;
    if (decisions === 2) assert.match(feedback, /sem requisição/u);
    return { type: 'click', role: 'button', name: 'Salvar' }; } };
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [task('contatos.cadastrar')], root,
      frontSha, profile: 'qa', browser, model, maxActionsPerTask: 2 });
    assert.equal(decisions, 2);
    assert.equal(record.saveOutcome, 'sem requisição');
    assert.equal(record.creationCapture.postSeen, false);
    assert.deepEqual(record.saveMessages, ['Informe o telefone com DDD']);
    assert.equal(journeyTaskSummary(record).saveOutcome, 'sem requisição');
    assert.deepEqual(journeyTaskSummary(record).saveMessages, ['Informe o telefone com DDD']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('alvo é reidentificado quando DOM muda e ambiguidade falha rápido', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button onclick="this.dataset.clicked = 1">Salvar</button>');
    const initial = await observeJourneyDom(page, { vocabulary: ['Salvar'] });
    await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<button>Outro</button>'));
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Salvar' }, initial.targets,
      { vocabulary: ['Salvar'] });
    assert.equal(await page.getByRole('button', { name: 'Salvar' }).getAttribute('data-clicked'), '1');
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button>Salvar</button>'));
    await assert.rejects(actJourneyAction(page, { type: 'click', role: 'button', name: 'Salvar' }, initial.targets,
      { vocabulary: ['Salvar'] }), /alvo mudou; observe de novo/u);
  } finally { await browser.close(); }
});

test('POST de criação com erro registra somente status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r9-error-'));
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  const browser = { async open() {}, async close() {},
    async observe() { return { title: 'Contatos', path: '/contact', controls: [
      { role: 'button', name: 'Salvar', enabled: true }], fields: [
      { role: 'textbox', name: 'Nome', value: name }, { role: 'textbox', name: 'Telefone', value: phone }],
    messages: [], state: {}, screenshot: Buffer.from('masked') }; },
    async act() {}, async awaitCreation() { return { capture: { postSeen: true, status: 409,
      jsonParsed: false, topKeys: [], refFound: false }, saveOutcome: 'erro 409' }; } };
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [task('contatos.cadastrar')], root,
      frontSha, profile: 'qa', browser, model: { async decide() {
        return { type: 'click', role: 'button', name: 'Salvar' }; } }, maxActionsPerTask: 1 });
    assert.equal(record.status, 'falhou');
    assert.equal(record.saveOutcome, 'erro 409');
    assert.equal(record.creationCapture.status, 409);
    assert.doesNotMatch(JSON.stringify(record), /response body|secret/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('erros de ação são classificados sem texto da página', () => {
  for (const [message, category] of [
    ['Element is not enabled', 'desabilitado'], ['Element is not visible', 'invisível'],
    ['intercepts pointer events', 'coberto'], ['Element is not stable', 'instável'],
    ['Element is detached from DOM', 'desanexado'], ['Timeout 8000ms exceeded', 'tempo'],
  ]) assert.equal(journeyActionCategory(new Error(message)), category);
  assert.deepEqual(journeyTaskSummary({ task: 'contatos.cadastrar', actionError: { categoria: 'tempo' } }).actionError,
    { categoria: 'tempo' });
});

test('resposta de erro do POST não lê corpo', async () => {
  const response = { status: () => 409, ok: () => false,
    json: async () => { throw new Error('corpo não pode ser lido'); } };
  assert.deepEqual((await journeyCreationResponse(response, 'contatos')).capture,
    { postSeen: true, status: 409, jsonParsed: false, topKeys: [], refFound: false });
});
