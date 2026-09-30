import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { actJourneyAction, journeyRequestAllowed, observeJourneyDom, verifyUniqueRecord } from './journey-runtime.mjs';
import { fixtureValue } from './journey-service.mjs';
import { qaRequestDecision } from '../scripts/guide-proof.mjs';

test('fichas opacas omitem placeholder, opção vazia e opção desabilitada', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div role="option" data-value="">Selecione...</div><div role="option" data-value="7">Teste</div><div role="option" data-value="8" aria-disabled="true">Indisponível</div>');
    const screen = await observeJourneyDom(page);
    assert.deepEqual(screen.controls.filter((item) => item.role === 'option').map((item) => item.name), ['opção 1']);
  } finally { await browser.close(); }
});

test('Adicionar bloco no editor aciona botão do sidebar, não o canvas', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button onclick="window.canvas=true">Adicionar bloco</button><div class="custom-height-sidebar"><button onclick="window.sidebar=true">Adicionar bloco</button></div>');
    const observed = await observeJourneyDom(page, { vocabulary: ['Adicionar bloco'] });
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Adicionar bloco (cabeçalho)', value: null },
      observed.targets, { vocabulary: ['Adicionar bloco'] });
    assert.deepEqual(await page.evaluate(() => ({ canvas: Boolean(window.canvas), sidebar: Boolean(window.sidebar) })),
      { canvas: false, sidebar: true });
  } finally { await browser.close(); }
});

test('PUT owner barra IDs ausentes e IDs fora da fixture antes da rede', () => {
  const request = (body) => ({ method: () => 'PUT', url: () => 'https://qa.example.test/api/v2/contacts/ref-1/owner',
    postData: () => JSON.stringify(body) });
  const context = { apiOrigin: 'https://qa.example.test', taskId: 'contatos.definir_responsavel',
    createdIds: new Set(['ref-1']), fixedIds: { department: new Set([7]), user: new Set([8]) } };
  assert.equal(journeyRequestAllowed(request({ departmentId: 7, userId: 8 }), context), true);
  for (const body of [{ userId: 8 }, { departmentId: 7 }, { departmentId: null, userId: 8 },
    { departmentId: 70, userId: 8 }, { departmentId: 7, userId: 80 }])
    assert.equal(journeyRequestAllowed(request(body), context), false);
});

test('PUT multipart de responsável não aceita usuário vazio', () => {
  const name = fixtureValue('contactName');
  const body = { Nome: name, ContatoTelefones: [], ContatoEmails: [],
    ContatoResponsaveis: [{ id: null, DepartmentId: 7, UserId: null }] };
  const request = { method: () => 'PUT', url: () => 'https://qa.example.test/api/v2/contacts/ref-1',
    postData: () => JSON.stringify(body) };
  const context = { apiOrigin: 'https://qa.example.test', taskId: 'contatos.definir_responsavel',
    generated: new Set([name]), createdIds: new Set(['ref-1']),
    contactSnapshot: { nome: name, responsibleUsers: [] },
    fixedIds: { department: new Set([7]), user: new Set([8]) } };
  assert.equal(journeyRequestAllowed(request, context), false);
});

test('editar só exige título persistido; menu pertence à tarefa de montar fluxo', async () => {
  let url = 'https://qa.example.test/bot/ref-1';
  const page = { url: () => url, async goto(next) { url = next; }, async reload() {},
    getByText: () => ({ async count() { return 1; } }), getByRole: () => ({ async count() { return 0; } }) };
  const title = fixtureValue('robotName', 2);
  const result = await verifyUniqueRecord({ page, task: { id: 'robos.editar', modulo: 'robos' },
    refs: ['ref-1'], targetUrl: 'https://qa.example.test', name: fixtureValue('robotName'), expectedValue: title,
    getPersisted: async () => ({ status: 200,
      body: { id: 7, idRef: 'ref-1', title, status: false, botEvents: [] } }) });
  assert.equal(result.confirmed, true);
});

test('host Railway da homologação é aceito; domínios de produção são recusados mesmo na allowlist', () => {
  const host = 'olah-ihelp-production.up.railway.app';
  const result = qaRequestDecision(`https://${host}/api/v2/contacts`, { local: false },
    { GUIDE_QA_ALLOWED_HOSTS: host });
  assert.equal(result.allowed, true);
  for (const production of ['ihelpchat.com', 'ihelpchat.com.br', 'app3.ihelpchat.com',
    'images.ihelpchat.com', 'r2.ihelpchat.com', 'api.ihelp.com.br'])
    assert.equal(qaRequestDecision(`https://${production}/`, { local: false },
      { GUIDE_QA_ALLOWED_HOSTS: production }).allowed, false, production);
});
