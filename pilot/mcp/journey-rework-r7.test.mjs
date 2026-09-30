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
    assert.equal(observed.fields.find((field) => field.name === 'Observação')?.filled, false);
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
      { role: 'textbox', name: 'Nome', required: current === 'contatos.cadastrar', filled: filled.has('Nome'), value: filled.has('Nome') ? name : null },
      { role: 'textbox', name: 'Telefone', required: current === 'contatos.cadastrar', filled: filled.has('Telefone'), value: filled.has('Telefone') ? phone : null }],
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
    assert.match(JSON.stringify(prompts[1]), /Nome ainda sem o valor do gerador/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('robô exige ref, título e status persistidos e aceita título no campo editável', async () => {
  let url = 'https://qa.example.test/bot/owned-ref';
  const saved = { id: 31, idRef: 'owned-ref', title: fixtureValue('robotName'), status: false };
  const page = { async goto(value) { url = value; }, async reload() {}, url: () => url,
    getByText: () => ({ count: async () => 0 }),
    getByRole: (role, options) => ({ count: async () => Number(role === 'textbox' && options.name === 'Digite o título do robô'),
      inputValue: async () => saved.title }) };
  const args = { page, task: { id: 'robos.criar', modulo: 'robos' }, refs: ['owned-ref'],
    targetUrl: 'https://qa.example.test', name: saved.title, expectedValue: saved.title,
    getPersisted: async () => ({ status: 200, body: { dados: { bot: saved } } }) };
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

test('robô concluído guarda ref e id e entrega ambos ao preparo das dependentes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r7-robot-'));
  const robot = fixtureValue('robotName');
  const preparedSeen = [];
  let taskId;
  let robotFilled = false;
  let channelSelected = false;
  const browser = { async open(task, prepared) { taskId = task.id; preparedSeen.push(structuredClone(prepared)); },
    async observe() { return { title: 'Robôs', path: '/bot', controls: [
      { role: 'textbox', name: 'Título do Robô', enabled: true },
      { role: 'button', name: 'Canais', enabled: true },
      { role: 'button', name: 'Salvar', enabled: true },
      { role: 'option', name: 'opção 1', enabled: true },
      { role: 'button', name: robot, enabled: true }], fields: [{ role: 'textbox', name: 'Título do Robô', value: robotFilled ? robot : null }],
      messages: taskId === 'robos.criar' && !channelSelected ? ['Precisa ter pelo menos um canal'] : [],
      state: {}, screenshot: Buffer.from('masked') }; },
    async act(action) { if (action.type === 'fill') robotFilled = true;
      if (action.type === 'click' && action.role === 'option') channelSelected = true; },
    async close() {}, async verify() { return { confirmed: true, observed: 'Ficha conferida',
      created: taskId === 'robos.criar' ? { robot, robotRef: 'owned-ref', robotId: 31 } : {},
      identity: { refs: ['owned-ref'], ids: [31] } }; } };
  const model = { async decide({ task, actions }) { const plan = task.id === 'robos.criar' ? [
    { type: 'fill', role: 'textbox', name: 'Título do Robô', value: robot },
    { type: 'click', role: 'button', name: 'Canais' },
    { type: 'click', role: 'option', name: 'opção 1' },
    { type: 'click', role: 'button', name: 'Salvar' },
  ] : [{ type: 'click', role: 'button', name: robot }];
  return plan[actions.length] ?? { type: 'finish' }; } };
  try {
    const records = await runJourneys({ module: 'robos', tasks: ['robos.criar', 'robos.buscar'].map((id) =>
      ({ id, modulo: 'robos', tarefa: id })), root, frontSha: 'a'.repeat(40), profile: 'qa', browser, model });
    assert.deepEqual(records.map((record) => record.status), ['concluída', 'concluída']);
    assert.deepEqual(records[0].created, { robot, robotRef: 'owned-ref', robotId: 31 });
    assert.equal(preparedSeen[1].robotRef, 'owned-ref');
    assert.equal(preparedSeen[1].robotId, 31);
  } finally { await rm(root, { recursive: true, force: true }); }
});
