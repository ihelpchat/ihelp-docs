import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureValue, runJourneys } from './journey-service.mjs';
import { journeyTaskSummary } from './server.mjs';
import * as runtime from './journey-runtime.mjs';

test('save do robô criado nesta execução nega empresa fora das fixtures', () => {
  const body = { id: 123, idRef: 'owned-ref', empresaId: 999, title: fixtureValue('robotName'),
    status: false, type: 1, botTrigger: 1,
    botEvents: [{ idRef: 'event-ref', type: 0, botId: 123 }] };
  const request = { method: () => 'PUT', url: () => 'https://qa.example.test/api/v2/bot/owned-ref/save',
    postData: () => JSON.stringify(body) };
  const context = { taskId: 'robos.salvar', apiOrigin: 'https://qa.example.test',
    generated: new Set([body.title]), createdIds: new Set([123, 'owned-ref']),
    fixedIds: { company: new Set([1]) } };
  assert.equal(runtime.journeyRequestAllowed(request, { ...context,
    fixedIds: { company: new Set([999]) } }), true);
  assert.equal(runtime.journeyRequestAllowed(request, context), false);
});

test('wrapper real repassa todos os métodos usados por journey-service', async () => {
  assert.equal(typeof runtime.makeLazyJourneyBrowser, 'function');
  const calls = [];
  const live = Object.fromEntries(['open', 'observe', 'act', 'awaitCreation', 'verify', 'diagnostics', 'close']
    .map((method) => [method, (...args) => { calls.push([method, ...args]); return method; }]));
  const browser = runtime.makeLazyJourneyBrowser(() => live);
  for (const method of Object.keys(live)) assert.equal(typeof browser[method], 'function', method);
  await browser.open('task');
  for (const method of Object.keys(live).filter((value) => value !== 'open'))
    assert.equal(await browser[method]('probe'), method);
  assert.deepEqual(calls.map(([method]) => method), Object.keys(live));
});

test('contato exige GET persistido e espera nome e telefone normalizado na ficha', async () => {
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  let url = 'https://front.qa.test/contact'; let waits = 0;
  let screenName = true; let screenPhone = true;
  let persisted = { idRef: 'owned-ref', nome: name, telefone: phone.replace(/\D/gu, '') };
  const page = {
    url: () => url,
    async goto(value) { url = value; }, async reload() {},
    waitForResponse: async (predicate) => {
      const response = { url: () => 'https://api.qa.test/api/v2/contacts/details/owned-ref',
        request: () => ({ method: () => 'GET' }), ok: () => true,
        json: async () => ({ dados: persisted }) };
      assert.ok(predicate(response));
      return response;
    },
    getByText: (value) => ({
      async count() { return value === name || value === `Telefone: ${phone.replace(/\D/gu, '')}` ? 1 : 0; },
      first() { return { async waitFor() { waits++; if (!screenName) throw new Error('timeout'); } }; },
    }),
    locator: () => ({ async innerText() { return screenPhone
      ? `${name}\nTelefone: ${phone.replace(/\D/gu, '')}` : name; } }),
  };
  const args = { page, task: { id: 'contatos.cadastrar', modulo: 'contatos' }, refs: ['owned-ref'],
    targetUrl: 'https://front.qa.test', name, expectedValue: name, expectedExtra: phone };
  const initial = await runtime.verifyUniqueRecord(args);
  assert.equal(initial.confirmed, true, initial.observed);
  assert.ok(waits > 0);
  for (const [change, category] of [
    [{ idRef: 'other-ref' }, 'ref'], [{ nome: 'Outro' }, 'nome persistido'],
    [{ telefone: '000' }, 'telefone persistido'],
  ]) {
    persisted = { idRef: 'owned-ref', nome: name, telefone: phone.replace(/\D/gu, ''), ...change };
    assert.equal((await runtime.verifyUniqueRecord(args)).observed, category);
  }
  persisted = { idRef: 'owned-ref', nome: name, telefone: phone.replace(/\D/gu, '') };
  screenName = false;
  assert.equal((await runtime.verifyUniqueRecord(args)).observed, 'nome na tela');
  screenName = true; screenPhone = false;
  assert.equal((await runtime.verifyUniqueRecord({ ...args, screenTimeoutMs: 1 })).observed, 'telefone na tela');
});

test('POST com ref guarda createdRef mesmo quando verificação falha', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r10-ref-'));
  const name = fixtureValue('contactName'); const phone = fixtureValue('phone');
  try {
    const browser = { async open() {}, async close() {},
      async observe() { return { title: 'Contatos', path: '/contact', controls: [
        { role: 'button', name: 'Salvar', enabled: true }], fields: [
        { role: 'textbox', name: 'Nome', value: name }, { role: 'textbox', name: 'Telefone', value: phone }],
      messages: [], state: {}, screenshot: Buffer.from('masked') }; },
      async act() {}, async awaitCreation() { return { capture: { postSeen: true, status: 200,
        jsonParsed: true, topKeys: ['dados'], refFound: true }, ref: 'owned-ref' }; },
      async verify() { return { confirmed: false, observed: 'telefone persistido' }; } };
    const [record] = await runJourneys({ module: 'contatos', tasks: [{ id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'Cadastrar' }],
      root, frontSha: 'a'.repeat(40), profile: 'qa', browser,
      model: { async decide() { return { type: 'click', role: 'button', name: 'Salvar' }; } }, maxActionsPerTask: 1 });
    assert.equal(record.status, 'inconclusiva');
    assert.equal(record.createdRef, 'owned-ref');
    assert.equal(journeyTaskSummary(record).createdRef, 'owned-ref');
  } finally { await rm(root, { recursive: true, force: true }); }
});
