import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { fixtureValue, runJourneys } from './journey-service.mjs';
import { journeyTaskSummary } from './server.mjs';
import * as runtime from './journey-runtime.mjs';
const { handleJourneyRoute, observeJourneyDom, verifyUniqueRecord } = runtime;

const task = (id) => ({ id, modulo: id.split('.')[0], tarefa: id });
const frontSha = 'a'.repeat(40);

test('escrita em outro host permitido bloqueia tarefa; terceiro continua no guard de rede', async () => {
  const target = { url: 'https://front.qa.test', local: false };
  const env = { GUIDE_QA_ALLOWED_HOSTS: 'front.qa.test,api.qa.test' };
  const run = async (host) => {
    let blocked; let outcome;
    const thirdPartyDenied = {};
    await handleJourneyRoute({ request: () => ({ method: () => 'POST',
      url: () => `https://${host}/api/v2/bot/owned-ref/publish`, postData: () => '{}' }),
    abort: async () => { outcome = 'abort'; }, fallback: async () => { outcome = 'fallback'; } },
    { apiOrigin: 'https://api.qa.test', target, env, thirdPartyDenied,
      taskId: 'robos.criar', onBlocked: (value) => { blocked = value; } });
    return { blocked, outcome, thirdPartyDenied };
  };
  const front = await run('front.qa.test');
  assert.equal(front.outcome, 'abort');
  assert.equal(front.blocked?.host, 'front.qa.test');
  assert.equal(front.blocked?.path, '/:id/:id/bot/:id/publish');
  const third = await run('third.test');
  assert.equal(third.outcome, 'fallback');
  assert.equal(third.blocked, undefined);
  assert.deepEqual(third.thirdPartyDenied, { 'third.test': 1 });
});

test('falha temporária inconclusiva reabre browser na segunda chamada', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r8-cache-'));
  let opens = 0;
  const options = { module: 'contatos', tasks: [task('contatos.cadastrar')], root, frontSha,
    profile: 'qa', browser: { async open() { opens++; throw new Error('browser temporariamente indisponível'); },
      async close() {} }, model: { async decide() { return { type: 'finish' }; } } };
  try {
    assert.equal((await runJourneys(options))[0].status, 'inconclusiva');
    assert.equal((await runJourneys(options))[0].status, 'inconclusiva');
    assert.equal(opens, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('prefixo padrão de telefone é vazio sem expor valor privado', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form><div><label>Telefone*</label><div class="phoneInputWrapper"><input class="PhoneInputInput" type="tel" value="+55" required></div></div><div><label>Observação</label><input value="padrão"></div></form>');
    const observed = await observeJourneyDom(page, { vocabulary: ['Telefone', 'Observação'] });
    assert.equal(observed.fields.find((field) => field.name === 'Telefone')?.filled, false);
    assert.equal(observed.fields.find((field) => field.name === 'Observação')?.filled, false);
    assert.doesNotMatch(JSON.stringify(observed.fields), /\+55/u);
  } finally { await browser.close(); }
});

test('plano de campos impede Salvar até telefone gerado estar no formulário', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r8-plan-'));
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  const values = { Nome: '', Telefone: '+55' }; const acted = []; const prompts = [];
  const browser = { async open() {}, async close() {}, async act(action) { acted.push(action);
    if (action.type === 'fill') values[action.name] = action.value; },
  async observe() { return { title: 'Contatos', path: '/contact', controls: [
    { role: 'textbox', name: 'Nome', enabled: true }, { role: 'textbox', name: 'Telefone', enabled: true },
    { role: 'button', name: 'Salvar', enabled: true }], fields: [
      { role: 'textbox', name: 'Nome', required: true, filled: Boolean(values.Nome), value: values.Nome || null },
      { role: 'textbox', name: 'Telefone', required: true, filled: values.Telefone !== '+55', value: values.Telefone === phone ? phone : null }],
    messages: [], state: {}, screenshot: Buffer.from('masked') }; },
  async verify() { return { confirmed: true, observed: 'Ficha conferida', created: { contact: name },
    identity: { refs: ['owned-ref'], ids: [31] } }; } };
  const model = { async decide(input) { prompts.push(input);
    if (input.feedback && /Nome/u.test(input.feedback)) return { type: 'fill', role: 'textbox', name: 'Nome', value: name };
    if (input.feedback && /Telefone/u.test(input.feedback)) return { type: 'fill', role: 'textbox', name: 'Telefone', value: phone };
    if (acted.some((action) => action.type === 'click')) return { type: 'finish' };
    return { type: 'click', role: 'button', name: 'Salvar' };
  } };
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [task('contatos.cadastrar')], root,
      frontSha, profile: 'qa', browser, model, maxActionsPerTask: 7 });
    assert.equal(record.status, 'concluída');
    assert.equal(acted[0]?.type, 'fill');
    assert.equal(acted[1]?.value, phone);
    assert.match(prompts.find((item) => /Telefone/u.test(item.feedback ?? ''))?.feedback ?? '', /Telefone.*phone/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('captura ref do POST no topo e exige consistência com URL', async () => {
  const data = { id: 31, idRef: 'owned-ref', title: fixtureValue('robotName'), status: false };
  assert.equal(typeof runtime.journeyCreationResponse, 'function');
  const diagnostic = await runtime.journeyCreationResponse({ url: () => 'https://api.qa.test/api/v2/bot',
    request: () => ({ method: () => 'POST' }), status: () => 200, ok: () => true,
    json: async () => data }, 'robos');
  assert.equal(diagnostic.ref, 'owned-ref');
  assert.deepEqual(diagnostic.capture, { postSeen: true, status: 200, jsonParsed: true,
    topKeys: ['id', 'idRef', 'status', 'title'], refFound: true });
  assert.deepEqual(journeyTaskSummary({ task: 'robos.criar', creationCapture: diagnostic.capture }).creationCapture,
    diagnostic.capture);
  const page = { url: () => 'https://front.qa.test/bot/wrong-ref',
    goto: async () => {}, reload: async () => {},
    waitForResponse: async () => ({ json: async () => ({ dados: data }) }),
    getByText: () => ({ count: async () => 1 }), getByRole: () => ({ count: async () => 1, inputValue: async () => data.title }) };
  const result = await verifyUniqueRecord({ page, task: task('robos.criar'), refs: ['owned-ref'],
    targetUrl: 'https://front.qa.test', name: data.title, expectedValue: data.title });
  assert.equal(result.confirmed, false);
});

test('validação de campo sem valor do gerador volta ao modelo e permite corrigir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r8-validation-'));
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  const values = { Nome: null, Telefone: null }; const acted = []; const feedbacks = [];
  const browser = { async open() {}, async close() {},
    async observe() { return { title: 'Contatos', path: '/contact', controls: [
      { role: 'textbox', name: 'Nome', enabled: true }, { role: 'textbox', name: 'Telefone', enabled: true },
      { role: 'button', name: 'Salvar', enabled: true }], fields: [
      { role: 'textbox', name: 'Nome', value: values.Nome },
      { role: 'textbox', name: 'Telefone', value: values.Telefone }],
      messages: values.Telefone ? [] : ['Informe o telefone com DDD'], state: {}, screenshot: Buffer.from('masked') }; },
    async act(action) { acted.push(action); if (action.type === 'fill') values[action.name] = action.value; },
    async verify() { return { confirmed: true, observed: 'Ficha conferida', created: { contact: name },
      identity: { refs: ['owned-ref'], ids: [31] } }; } };
  const model = { async decide({ feedback, actions }) { feedbacks.push(feedback);
    if (!values.Nome) return { type: 'fill', role: 'textbox', name: 'Nome', value: name };
    if (!values.Telefone) return { type: 'fill', role: 'textbox', name: 'Telefone', value: phone };
    if (!actions.some((action) => action.type === 'click')) return { type: 'click', role: 'button', name: 'Salvar' };
    return { type: 'finish' };
  } };
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [task('contatos.cadastrar')], root,
      frontSha, profile: 'qa', browser, model });
    assert.equal(record.status, 'concluída');
    assert.match(feedbacks[1], /Telefone.*phone/u);
    assert.deepEqual(acted.map((action) => action.type), ['fill', 'fill', 'click']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verificação arma waitForResponse antes de goto', async () => {
  const calls = []; let currentUrl = 'https://front.qa.test/bot/owned-ref';
  const data = { id: 31, idRef: 'owned-ref', title: fixtureValue('robotName'), status: false };
  const page = { async goto(url) { calls.push('goto'); currentUrl = url; }, async reload() { calls.push('reload'); },
    url: () => currentUrl, waitForResponse: async () => { calls.push('wait'); return { json: async () => ({ dados: data }) }; },
    getByText: () => ({ count: async () => 1 }), getByRole: () => ({ count: async () => 1, inputValue: async () => data.title }) };
  const result = await verifyUniqueRecord({ page, task: task('robos.criar'), refs: ['owned-ref'],
    targetUrl: 'https://front.qa.test', name: data.title, expectedValue: data.title });
  assert.equal(result.confirmed, true);
  assert.deepEqual(calls.slice(0, 2), ['wait', 'goto']);
});
