import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { fixtureValue, runJourneys } from './journey-service.mjs';
import { observeJourneyDom, verifyUniqueRecord } from './journey-runtime.mjs';

test('observação distingue vazio de preenchido sem revelar valor e ignora país do telefone', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><div><label>Nome*</label><input required></div>
      <div><label>Telefone*</label><div class="phoneInputWrapper"><button type="button">+44</button>
      <select required><option value="GB" selected>Reino Unido</option></select>
      <input class="PhoneInputInput" type="tel" required></div></div>
      <div><label>Observação</label><input value="dado privado da conta"></div></form>`);
    const observed = await observeJourneyDom(page, { vocabulary: ['Nome', 'Telefone', 'Observação'] });
    assert.equal(observed.fields.find((field) => field.name === 'Nome')?.filled, false);
    assert.equal(observed.fields.find((field) => field.name === 'Telefone')?.filled, false);
    assert.equal(observed.fields.find((field) => field.name === 'Observação')?.filled, true);
    assert.equal(observed.fields.some((field) => field.role === 'combobox'), false);
    assert.doesNotMatch(JSON.stringify(observed.fields), /dado privado da conta|Reino Unido|GB/u);
  } finally { await browser.close(); }
});

test('finish prematuro devolve obrigatório vazio ao modelo e cria preparo para dependente', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r7-'));
  const name = fixtureValue('contactName');
  const phone = fixtureValue('phone');
  const tasks = ['contatos.cadastrar', 'contatos.buscar'].map((id) => ({ id, modulo: 'contatos', tarefa: id }));
  const seen = [];
  let current;
  let filled = new Set();
  const browser = {
    async open(task, prepared) { current = task.id; filled = new Set(); seen.push({ task: current, prepared: structuredClone(prepared) }); },
    async observe() { return { title: 'Contatos', path: '/contact', controls: [
      { role: 'textbox', name: 'Nome', enabled: true }, { role: 'textbox', name: 'Telefone', enabled: true },
      { role: 'button', name: 'Salvar', enabled: true }], fields: [
      { role: 'textbox', name: 'Nome', required: current === 'contatos.cadastrar', filled: filled.has('Nome') },
      { role: 'textbox', name: 'Telefone', required: current === 'contatos.cadastrar', filled: filled.has('Telefone') }],
    messages: [], state: {}, screenshot: Buffer.from('masked') }; },
    async act(action) { if (action.type === 'fill') filled.add(action.name); },
    async verify() { return { confirmed: true, observed: 'Ficha conferida', created: { contact: name },
      identity: { refs: ['created-ref'], ids: [7] } }; }, async close() {},
  };
  const prompts = [];
  const model = { async decide(input) { prompts.push(input); const actions = input.actions;
    if (current === 'contatos.buscar') return actions.length ? { type: 'finish' }
      : { type: 'fill', role: 'textbox', name: 'Nome', value: name };
    if (actions.length === 0 && prompts.filter((item) => item.task.id === current).length === 1) return { type: 'finish' };
    return [
      { type: 'fill', role: 'textbox', name: 'Nome', value: name },
      { type: 'fill', role: 'textbox', name: 'Telefone', value: phone },
      { type: 'click', role: 'button', name: 'Salvar' }, { type: 'finish' },
    ][actions.length];
  } };
  try {
    const records = await runJourneys({ module: 'contatos', tasks, root, frontSha: 'a'.repeat(40),
      profile: 'qa', browser, model, maxActionsPerTask: 8 });
    assert.equal(records[0].status, 'concluída');
    assert.equal(records[1].status, 'concluída');
    assert.equal(seen[1].prepared.contact, name);
    assert.deepEqual(seen[1].prepared.identity, { refs: ['created-ref'], ids: [7] });
    assert.match(JSON.stringify(prompts[1]), /obrigatório vazio: Nome; use o valor do gerador/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('robô exige ref, título e status persistidos e aceita título no campo editável', async () => {
  let url;
  const saved = { id: 31, idRef: 'owned-ref', title: fixtureValue('robotName'), status: false };
  const page = { async goto(value) { url = value; }, async reload() {}, url: () => url,
    waitForResponse: async () => ({ json: async () => ({ dados: { bot: saved } }) }),
    getByText: () => ({ count: async () => 0 }),
    getByRole: (role, options) => ({ count: async () => Number(role === 'textbox' && options.name === 'Digite o título do robô'),
      inputValue: async () => saved.title }) };
  const args = { page, task: { id: 'robos.criar', modulo: 'robos' }, refs: ['owned-ref'],
    targetUrl: 'https://qa.example.test', name: saved.title, expectedValue: saved.title };
  assert.equal((await verifyUniqueRecord(args)).confirmed, true);
  for (const [change, category] of [
    [{ idRef: 'wrong-ref' }, 'ref'], [{ title: 'Outro' }, 'título persistido'],
    [{ status: true }, 'status persistido'],
  ]) {
    Object.assign(saved, change);
    const result = await verifyUniqueRecord(args);
    assert.equal(result.confirmed, false);
    assert.equal(result.observed, category);
    Object.assign(saved, { idRef: 'owned-ref', title: fixtureValue('robotName'), status: false });
  }
  page.getByRole = () => ({ count: async () => 0 });
  assert.equal((await verifyUniqueRecord(args)).observed, 'título na tela');
});
