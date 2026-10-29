import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch } from '../scripts/visual/measure.mjs';
import * as runtime from './journey-runtime.mjs';
import { policyDecision, realCompanyFixture, runJourneys } from './journey-service.mjs';

const send = { type: 'click', role: 'button', name: 'Enviar mensagem', value: null };
const title = 'Teste FAQ Robô Exemplo 01 · 1234abcd';
const message = 'Teste FAQ Opção Exemplo 01';
const generated = new Set([title, message]);
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('empresa real só permite composição local com prova do editor; envio comum continua proibido', () => {
  assert.equal(policyDecision(send, generated, 'robos.montar_menu', { realCompany: true, localRobotDraft: true }).allowed, true);
  for (const [task, action, context] of [
    ['robos.montar_menu', send, { realCompany: true }],
    ['robos.montar_menu', send, { realCompany: true, localRobotDraft: false }],
    ['contatos.editar', send, { realCompany: true, localRobotDraft: true }],
    ['robos.montar_menu', { ...send, name: 'Publicar' }, { realCompany: true, localRobotDraft: true }],
    ['robos.montar_menu', { ...send, value: message }, { realCompany: true, localRobotDraft: true }],
  ]) assert.equal(policyDecision(action, generated, task, context).allowed, false);
});

async function withEditor(run) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let writes = 0;
  try {
    await context.route('**/*', route => {
      const request = route.request();
      if (request.method() !== 'GET') { writes++; return route.abort(); }
      if (request.resourceType() !== 'document') return route.abort();
      return route.fulfill({ contentType: 'text/html', body: `<h1>${title}</h1><div class="custom-height-sidebar"><input placeholder="Título da mensagem" value="${message}"><div><textarea>${message}</textarea><button onclick="window.composed=document.querySelector('textarea').value"><svg width="20" height="20"><rect width="20" height="20"/></svg></button></div></div>` });
    });
    const page = await context.newPage(); await page.goto('https://qa.example.test/bot/own-1');
    const vocabulary = ['Enviar mensagem', 'Título da mensagem'];
    const observed = await runtime.observeJourneyDom(page, { vocabulary, generated });
    const proof = { taskId: 'robos.montar_menu', origin: 'https://qa.example.test', robotRef: 'own-1',
      robotTitle: title, companyId: '42', robot: { idRef: 'own-1', title, status: false, empresaId: 42 },
      owned: true, selected: observed.targets[JSON.stringify(['button', 'Enviar mensagem'])], generated };
    await run(page, proof, observed, vocabulary, () => writes);
  } finally { await context.close(); }
}

test('composição do robô inativo próprio modifica só o rascunho local', async () => {
  await withEditor(async (page, proof, observed, vocabulary, writes) => {
    const allowed = await (runtime.localRobotDraftAllowed?.(page, send, proof) ?? false);
    assert.equal(allowed, true);
    await runtime.actJourneyAction(page, send, observed.targets, { vocabulary, generated });
    assert.equal(await page.evaluate(() => window.composed), message);
    assert.equal(writes(), 0);
  });
});

test('prova local fecha para outra conta, robô, tarefa, estado, origem, alvo e conteúdo', async () => {
  await withEditor(async (page, proof) => {
    for (const change of [
      { owned: false }, { robotRef: 'other-1' }, { taskId: 'robos.salvar' },
      { origin: 'https://other.example.test' }, { companyId: '43' }, { selected: null },
      { robot: { ...proof.robot, status: true } }, { robot: { ...proof.robot, status: null } },
      { robot: { ...proof.robot, title: 'Outro título' } },
      { robot: { ...proof.robot, empresaId: 43 } }, { robot: null },
    ]) assert.equal(await (runtime.localRobotDraftAllowed?.(page, send, { ...proof, ...change }) ?? false), false);
    await page.locator('textarea').fill('texto não autorizado');
    assert.equal(await (runtime.localRobotDraftAllowed?.(page, send, proof) ?? false), false);
    await page.locator('textarea').fill(message);
    await page.locator('.custom-height-sidebar').evaluate(node => node.className = 'attendance');
    assert.equal(await (runtime.localRobotDraftAllowed?.(page, send, proof) ?? false), false);
  });
});

test('browser lazy delega a prova local ao browser da execução', async () => {
  let checked = 0;
  const lazy = runtime.makeLazyJourneyBrowser(async () => ({ async open() {},
    async policyContext() { checked++; return { localRobotDraft: true }; }, async close() {} }));
  try {
    await lazy.open();
    assert.deepEqual(await (lazy.policyContext?.(send) ?? {}), { localRobotDraft: true });
    assert.equal(checked, 1);
  } finally { await lazy.close(); }
});

for (const authorized of [true, false]) test(`runJourneys consulta a prova antes de compor: ${authorized}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-draft-'));
  const marker = '1234abcd', phone = '+44 20 7946 0099';
  const fixture = (kind, n = 1) => realCompanyFixture(kind, n, marker, phone);
  const vocabulary = ['Robôs', 'Título do Robô', 'Canais', 'opção 1', 'Salvar', 'Adicionar bloco', 'Mensagem', 'Opção um', 'Opção dois', 'Enviar mensagem'];
  let current, values, composed = 0, checks = 0;
  const actions = {
    'robos.criar': [{ type: 'fill', role: 'textbox', name: 'Título do Robô', value: fixture('robotName') },
      { type: 'click', role: 'button', name: 'Canais', value: null },
      { type: 'click', role: 'option', name: 'opção 1', value: null },
      { type: 'click', role: 'button', name: 'Salvar', value: null }, { type: 'finish', role: null, name: null, value: null }],
    'robos.montar_menu': [{ type: 'click', role: 'button', name: 'Adicionar bloco', value: null },
      { type: 'fill', role: 'textbox', name: 'Mensagem', value: fixture('menuQuestion') },
      { type: 'fill', role: 'textbox', name: 'Opção um', value: fixture('menuOption', 1) },
      { type: 'fill', role: 'textbox', name: 'Opção dois', value: fixture('menuOption', 2) }, send,
      { type: 'click', role: 'button', name: 'Salvar', value: null }, { type: 'finish', role: null, name: null, value: null }],
  };
  const fake = {
    async open(task) { current = task.id; values = new Map(); return { account: { userId: 'user-1', companyId: '42' } }; },
    async observe() { return { title: 'Robôs', path: '/bot/own-1', state: {}, messages: [],
      controls: [...['Salvar', 'Adicionar bloco', 'Enviar mensagem', 'Canais'].map(name => ({ role: 'button', name, enabled: true })),
        { role: 'option', name: 'opção 1', enabled: true }],
      fields: ['Título do Robô', 'Mensagem', 'Opção um', 'Opção dois'].map(name => ({ role: 'textbox', name, value: values.get(name) ?? null, filled: values.has(name) })) }; },
    async policyContext(action) { if (action.name === send.name) checks++; return { localRobotDraft: authorized }; },
    async act(action) { if (action.type === 'fill') values.set(action.name, action.value); if (action.name === send.name) composed++; },
    async awaitCreation() { return { capture: { postSeen: true, status: 200, refFound: true }, ref: 'own-1' }; },
    async verify() { return { confirmed: true, observed: 'feito', ...(current === 'robos.criar'
      ? { created: { robot: fixture('robotName'), robotRef: 'own-1', robotId: 17 }, identity: { refs: ['own-1'], ids: [17] } } : {}) }; },
    async close() {},
  };
  try {
    const records = await runJourneys({ module: 'robos', tasks: [
      { id: 'robos.criar', modulo: 'robos', tarefa: 'Criar robô' },
      { id: 'robos.montar_menu', modulo: 'robos', tarefa: 'Montar menu' },
    ], root, marker, frontSha: 'a'.repeat(40), profile: 'qa', realCompany: true, testPhone: phone,
    allowedScreenLabels: new Set(vocabulary), browser: fake,
    model: { async decide({ actions: done }) { return actions[current][done.length]; } }, cacheBypass: true });
    assert.equal(records[0].status, 'concluída', JSON.stringify(records[0]));
    assert.equal(records[1].status, authorized ? 'concluída' : 'bloqueada', JSON.stringify(records[1]));
    assert.equal(composed, authorized ? 1 : 0);
    if (authorized) assert.equal(checks, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
