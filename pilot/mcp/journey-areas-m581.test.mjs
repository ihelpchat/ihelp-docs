import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { areaPlans, areaWriteAllowed, areaFixtureValue, areaStageSafe, nextAreaAction, verifyAreaResult } from './journey-plans/index.mjs';
import { journeyRequestAllowed, journeyWriteDecision } from './journey-runtime.mjs';
import { journeyCoverage } from './journey-service.mjs';
import { runJourneys, policyDecision } from './journey-service.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { observeJourneyDom, actJourneyAction } from './journey-runtime.mjs';

const catalog = JSON.parse(await readFile(new URL('../architecture/faq-regua/tarefas-ouro.json', import.meta.url)));
const matrix = JSON.parse(await readFile(new URL('../architecture/coverage-matrix.json', import.meta.url)));
const modules = ['crm', 'campanhas', 'agendamentos', 'tarefas'];
const request = (method, path, body) => ({ method: () => method, url: () => `https://api.example.test/api/v2${path}`,
  postData: () => body == null ? null : JSON.stringify(body), headers: () => ({ 'content-type': 'application/json' }) });
const taskRef = '123e4567-e89b-42d3-a456-426614174000';
const context = (taskId) => ({ taskId, apiOrigin: 'https://api.example.test', generated: new Set(['Card Exemplo 01', 'Tarefa Exemplo 01', 'Tarefa Exemplo 01 Editada', 'Nota Exemplo 01']),
  createdIds: new Set(taskId === 'tarefas.criar' ? [11] : [11, taskRef]),
  fixedIds: { card: new Set([7]), stage: new Set([4]), funnel: new Set([5]), contact: new Set([6]), self: new Set([3]) } });

test('cada área possui 4 a 8 tarefas, plano para permitidas e ponteiro na matriz', () => {
  for (const area of modules) {
    const tasks = catalog.tarefas.filter((item) => item.modulo === area);
    assert.ok(tasks.length >= 4 && tasks.length <= 8, area);
    assert.ok(tasks.every((item) => item.pontoDePartida && item.preRequisitos && item.resultadoEsperadoObservavel
      && item.acaoProibidaAoAgente));
    assert.ok(tasks.filter((item) => item.acaoProibidaAoAgente.startsWith('não')).every((item) => areaPlans[item.id]));
    assert.ok(tasks.filter((item) => item.acaoProibidaAoAgente.startsWith('sim')).every((item) => !areaPlans[item.id]));
    assert.deepEqual(matrix.find((item) => item.module.toLowerCase() === area)?.tasks,
      tasks.map((item) => item.id));
  }
});

test('cobertura só contabiliza tarefas que a política permite executar', () => {
  const records = catalog.tarefas.filter((item) => modules.includes(item.modulo))
    .map((item) => ({ task: item.id, status: 'inconclusiva' }));
  assert.equal(journeyCoverage(records).eligible,
    records.filter((item) => Boolean(areaPlans[item.task])).length);
});

test('plano determinístico usa alvo presente e não conclui sem verificação persistida', () => {
  const screen = { controls: [{ role: 'button', name: 'Nova Tarefa', enabled: true }], fields: [] };
  assert.deepEqual(nextAreaAction('tarefas.criar', screen, [], () => 'Tarefa Exemplo 01'),
    { type: 'click', role: 'button', name: 'Nova Tarefa', value: null });
  assert.equal(nextAreaAction('tarefas.criar', { controls: [], fields: [] }, [], () => 'Tarefa Exemplo 01'), null);
  const read = { status: 200, method: 'GET', url: 'https://api.example.test/api/v2/task' };
  assert.equal(verifyAreaResult('tarefas.criar', { ...read, body: [{ id: 11, title: 'Tarefa Exemplo 01' }] },
    { createdIds: new Set([11]), generated: new Set(['Tarefa Exemplo 01']) }), true);
  assert.equal(verifyAreaResult('tarefas.criar', { ...read, body: [] },
    { createdIds: new Set([11]), generated: new Set(['Tarefa Exemplo 01']) }), false);
  assert.equal(verifyAreaResult('tarefas.criar', { ...read, url: 'https://api.example.test/api/v2/contacts',
    body: [{ id: 11, title: 'Tarefa Exemplo 01' }] },
  { createdIds: new Set([11]), generated: new Set(['Tarefa Exemplo 01']) }), false);
  assert.equal(verifyAreaResult('tarefas.criar', { ...read, body: [{ id: 11, title: 'Tarefa Exemplo 01' }] },
    { apiOrigin: 'https://outra.example.test', createdIds: new Set([11]), generated: new Set(['Tarefa Exemplo 01']) }), false);
  assert.equal(areaFixtureValue('taskName', { marker: 'a1b2c3d4' }), 'Tarefa Exemplo 01 · a1b2c3d4');
});

test('escritas reais do front aceitas só para fixture criada ou id opaco autorizado', () => {
  const cases = [
    ['crm.criar_card', 'POST', '/crm/card', { title: 'Card Exemplo 01', description: '', stageId: 4,
      funnelId: 5, contactId: 6, responsibleId: 3, estimatedValue: 0, status: 2, order: 0, id: 0,
      createdDate: new Date().toISOString(), priority: null }],
    ['tarefas.criar', 'POST', '/task', { idRef: taskRef, title: 'Tarefa Exemplo 01', description: '', assigneeUserId: 3 }],
    ['tarefas.editar', 'PUT', '/task/11', { idRef: taskRef, title: 'Tarefa Exemplo 01 Editada', description: '', assigneeUserId: 3, status: 1, linkType: null }],
    ['tarefas.concluir', 'PATCH', '/task/11/status', { status: 3 }],
    ['tarefas.arquivar', 'POST', '/task/11/archive', { isArchived: true }],
    ['crm.adicionar_nota', 'POST', '/crm/card/7/notes', { cardId: 7, title: '', description: 'Nota Exemplo 01', isPrivate: false }],
  ];
  for (const [taskId, method, path, body] of cases) {
    assert.equal(areaWriteAllowed(request(method, path, body), context(taskId)), true, taskId);
    assert.equal(journeyRequestAllowed(request(method, path, body), context(taskId)), true, `runtime: ${taskId}`);
    assert.equal(journeyWriteDecision(request(method, path, body), context(taskId)).allowed, true,
      `route: ${taskId}`);
  }
});

test('nega envio, disparo, publicação, agendamento real, ids alheios e valores externos', () => {
  const denied = [
    ['campanhas.disparar', 'POST', '/marketing', { status: 0 }],
    ['campanhas.agendar_envio', 'POST', '/marketing', { status: 0 }],
    ['campanhas.buscar', 'PUT', '/marketing/campaign-status/x/1', {}],
    ['campanhas.buscar', 'POST', '/bot/7/publish', {}],
    ['tarefas.criar', 'POST', '/configurations/channels/7/connect', {}],
    ['tarefas.criar', 'POST', '/contacts/import', { businessId: 2 }],
    ['agendamentos.criar_envio', 'POST', '/ScheduledMessages', { message: 'oi' }],
    ['tarefas.criar', 'POST', '/customers/send-message', { texto: 'oi' }],
    ['crm.mover_etapa', 'PUT', '/crm/card/7/stage/4', {}],
    ['tarefas.criar', 'POST', '/task', { idRef: taskRef, title: 'Tarefa Exemplo 01', description: '', assigneeUserId: 3, send: true }],
    ['tarefas.criar', 'POST', '/task', { idRef: taskRef, title: 'Tarefa Exemplo 01', description: '', assigneeUserId: 4 }],
    ['tarefas.criar', 'POST', '/task', { idRef: 'id-inventado', title: 'Tarefa Exemplo 01', description: '', assigneeUserId: 3 }],
    ['tarefas.arquivar', 'DELETE', '/task/11', {}],
    ['tarefas.concluir', 'PATCH', '/task/12/status', { status: 3 }],
    ['tarefas.criar', 'POST', '/task', { title: 'Tarefa externa', description: '', status: 1 }],
    ['crm.adicionar_nota', 'POST', '/crm/card/7/notes', { cardId: 7, title: '', description: 'texto externo', isPrivate: false }],
    ['crm.mover_etapa', 'PUT', '/crm/card/7/stage/99', {}],
    ['crm.criar_card', 'POST', '/crm/card', { title: 'Card Exemplo 01', stageId: 4, funnelId: 5,
      contactId: 6, responsibleId: 99, status: 2, order: 0, id: 0 }],
  ];
  for (const [taskId, method, path, body] of denied)
    assert.equal(journeyRequestAllowed(request(method, path, body), context(taskId)), false, `${taskId} ${path}`);
});

test('nega PATCH de tarefa criada quando a origem da API difere', () => {
  const foreign = { ...request('PATCH', '/task/11/status', { status: 3 }),
    url: () => 'https://outra.example.test/api/v2/task/11/status' };
  assert.equal(areaWriteAllowed(foreign, context('tarefas.concluir')), false);
  assert.equal(journeyRequestAllowed(foreign, context('tarefas.concluir')), false);
});

test('CRM só usa etapa sem regras ativas nem tarefas automáticas', () => {
  assert.equal(areaStageSafe([], []), true);
  assert.equal(areaStageSafe([{ isActive: true, actions: [{ type: 'send' }] }], []), false);
  assert.equal(areaStageSafe([], [{ isActive: true }]), false);
  assert.equal(areaStageSafe(null, []), false);
});

test('estado de agendamento reconhece enviado e pendente na leitura persistida', () => {
  const base = { status: 200, method: 'GET', url: 'https://api.example.test/api/v2/ScheduledMessages/calendar/schedules/2026-10-10' };
  for (const sent of [true, false])
    assert.equal(verifyAreaResult('agendamentos.consultar_estado', { ...base, body: [{ idRef: taskRef, sent }] },
      { fixedIds: { schedule: new Set([taskRef]) }, apiOrigin: 'https://api.example.test' }), true);
});

test('edição só confirma o título exato salvo nesta jornada', () => {
  const read = { status: 200, method: 'GET', url: 'https://api.example.test/api/v2/task' };
  const scope = { apiOrigin: 'https://api.example.test', createdIds: new Set([11]),
    generated: new Set(['Tarefa Exemplo 01', 'Tarefa Exemplo 01 Editada']),
    expectedValue: 'Tarefa Exemplo 01 Editada' };
  assert.equal(verifyAreaResult('tarefas.editar', { ...read, body: [{ id: 11, title: 'Tarefa Exemplo 01' }] }, scope), false);
  assert.equal(verifyAreaResult('tarefas.editar', { ...read, body: [{ id: 11, title: 'Tarefa Exemplo 01 Editada' }] }, scope), true);
  assert.equal(verifyAreaResult('tarefas.editar', { ...read, body: [{ id: 11, title: 'Tarefa Exemplo 01 Editada' }] },
    { ...scope, expectedValue: undefined }), false);
});

test('CRM abre ContactSelect, busca contato fictício e só então escolhe a ficha no DOM', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<input role="combobox" placeholder="Buscar por nome, telefone ou e-mail..." aria-expanded="false">
      <div id="menu" style="display:none"><div role="option" data-value="6">Contato Exemplo 01 · a1b2c3d4</div></div>
      <script>const input = document.querySelector('input');
        input.onclick = () => { input.setAttribute('aria-expanded', 'true'); };
        input.oninput = () => { document.querySelector('#menu').style.display = input.value.length >= 3 ? 'block' : 'none'; };</script>`);
    const fixture = { cardName: 'Card Exemplo 01 · a1b2c3d4', stageName: 'Etapa Exemplo 01',
      contactSearch: 'Contato Exemplo 01 · a1b2c3d4', contactOption: 'opção 1', selfLabel: 'Atendente Exemplo 01' };
    const actions = [{ type: 'click', role: 'button', name: 'Adicionar oportunidade', value: null },
      { type: 'fill', role: 'textbox', name: 'Título do card', value: fixture.cardName },
      { type: 'click', role: 'button', name: fixture.stageName, value: null }];
    const next = async () => {
      const screen = await observeJourneyDom(page, { vocabulary: ['Buscar por nome, telefone ou e-mail...'],
        generated: new Set(Object.values(fixture)) });
      return { screen, action: nextAreaAction('crm.criar_card', screen, actions, (kind) => fixture[kind]) };
    };
    let step = await next();
    assert.deepEqual([step.action?.type, step.action?.role, step.action?.name],
      ['click', 'combobox', 'Buscar por nome, telefone ou e-mail...']);
    await actJourneyAction(page, step.action, step.screen.targets);
    actions.push(step.action);
    step = await next();
    assert.deepEqual([step.action?.type, step.action?.role, step.action?.value],
      ['fill', 'combobox', fixture.contactSearch]);
    await actJourneyAction(page, step.action, step.screen.targets);
    actions.push(step.action);
    step = await next();
    assert.deepEqual([step.action?.type, step.action?.role, step.action?.name], ['click', 'option', 'opção 1']);
  } finally { await browser.close(); }
});

test('campanha só confirma modo lista quando o indicador do front muda após o clique', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button aria-label="Modo lista" class="bg-white"></button>
      <button aria-label="Modo card" class="bg-primary-50"></button>`);
    const read = { status: 200, method: 'GET', url: 'https://api.example.test/api/v2/marketing/campaigns',
      body: [{ idRef: 'campaign-1', titulo: 'Campanha Exemplo 01' }] };
    const scope = { apiOrigin: 'https://api.example.test', fixedIds: { campaign: new Set(['campaign-1']) },
      generated: new Set(['Campanha Exemplo 01']) };
    let screen = await observeJourneyDom(page, { vocabulary: ['Modo lista', 'Modo card'] });
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Modo lista' }, screen.targets);
    screen = await observeJourneyDom(page, { vocabulary: ['Modo lista', 'Modo card'] });
    assert.equal(verifyAreaResult('campanhas.alternar_visualizacao', read, { ...scope, screen }), false);
    await page.locator('button[aria-label="Modo lista"]').evaluate((button) => {
      button.onclick = () => { button.className = 'bg-primary-50';
        document.querySelector('button[aria-label="Modo card"]').className = 'bg-white'; };
    });
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Modo lista' }, screen.targets);
    screen = await observeJourneyDom(page, { vocabulary: ['Modo lista', 'Modo card'] });
    assert.equal(verifyAreaResult('campanhas.alternar_visualizacao', read, { ...scope, screen }), true,
      JSON.stringify(screen.state));
  } finally { await browser.close(); }
});

test('runtime aceita as quatro áreas, executa plano e só conclui após verify', async () => {
  for (const area of modules) {
    const entry = Object.entries(areaPlans).find(([id, plan]) => id.startsWith(`${area}.`) && plan.steps.length);
    const [id, plan] = entry;
    const root = await mkdtemp(join(tmpdir(), 'journey-area-'));
    let verified = 0;
    const areaFixtureContext = { stageName: 'Etapa Exemplo 01', contactSearch: 'Contato Exemplo 01 · a1b2c3d4', contactOption: 'opção 1',
      selfLabel: 'Atendente Exemplo 01', selfOption: 'opção 1', scheduleDay: '10' };
    const browser = { async open() { return { areaFixtureContext }; }, async observe() { return { title: area, path: plan.startRoute,
      controls: plan.steps.filter((step) => step.type === 'click').map((step) => ({ role: step.role,
        name: step.name ?? areaFixtureContext[step.nameFrom], enabled: true })),
      fields: plan.steps.filter((step) => step.type === 'fill').map((step) => ({ role: step.role, name: step.name,
        value: null, required: false })), messages: [], state: {}, screenshot: Buffer.from('masked-png') }; },
      async act() {}, async verify() { verified++; return { confirmed: false, observed: 'leitura não confirmou' }; },
      async close() {} };
    try {
      const [record] = await runJourneys({ module: area, tasks: [catalog.tarefas.find((item) => item.id === id)], root,
        frontSha: 'a'.repeat(40), profile: 'qa', marker: 'a1b2c3d4', browser,
        model: { async decide() { throw Error('plano determinístico não usado'); } }, deterministicPlans: true });
      assert.equal(verified, 1, `${id}: ${record.reason}; ${JSON.stringify(record.actions)}`);
      assert.equal(record.status, 'inconclusiva', id);
      assert.ok(record.screens.length, id);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  assert.equal(policyDecision({ type: 'fill', role: 'textbox', name: 'Título', value: 'Tarefa Exemplo 01 · a1b2c3d4' },
    new Set(['Tarefa Exemplo 01 · a1b2c3d4']), 'tarefas.criar').allowed, true);
});
