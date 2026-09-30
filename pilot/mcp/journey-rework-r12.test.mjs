import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { runJourneys, fixtureValue, policyDecision } from './journey-service.mjs';
import * as runtime from './journey-runtime.mjs';
const { journeyRequestAllowed, loadQaFixtureIds, observeJourneyDom, actJourneyAction, verifyUniqueRecord } = runtime;

const task = (id, extra = {}) => ({ id, modulo: 'contatos', tarefa: id,
  resultadoEsperadoObservavel: 'feito', ...extra });

test('dependente não reaproveita cache quando a criação muda de identidade', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r12-cache-'));
  let serial = 0; let edits = 0; let entered;
  const marker = 'a1b2c3d4';
  const browser = { async open(current) { entered = new Map(); if (current.id === 'contatos.cadastrar') serial++; if (current.id === 'contatos.editar') edits++; },
    async close() {}, async observe() { return { title: 'Contatos', path: '/contact', controls: [
      { role: 'button', name: 'Salvar', enabled: true }], fields: [
      { role: 'textbox', name: 'Nome', value: entered.get('Nome') ?? null },
      { role: 'textbox', name: 'Telefone', value: entered.get('Telefone') ?? null }],
    messages: [], state: {}, screenshot: Buffer.from('masked') }; },
    async act(action) { if (action.type === 'fill') entered.set(action.name, action.value); },
    async awaitCreation() { return { capture: { postSeen: true, status: 200, refFound: true }, ref: `ref-${serial}` }; },
    async verify(current) { return { confirmed: true, observed: 'feito',
      created: current.id === 'contatos.cadastrar' ? { contact: fixtureValue('contactName', 1, marker) } : {},
      identity: { refs: [`ref-${serial}`], ids: [serial] } }; } };
  const model = { async decide({ task: current, actions }) { return (current.id === 'contatos.editar'
    ? [{ type: 'fill', role: 'textbox', name: 'Nome', value: fixtureValue('editedName', 1, marker) },
      { type: 'click', role: 'button', name: 'Salvar' }, { type: 'finish' }]
    : [{ type: 'fill', role: 'textbox', name: 'Nome', value: fixtureValue('contactName', 1, marker) },
      { type: 'fill', role: 'textbox', name: 'Telefone', value: fixtureValue('phone', 1, marker) },
      { type: 'click', role: 'button', name: 'Salvar' }])[actions.length]; } };
  try {
    const options = { module: 'contatos', root, marker, frontSha: 'a'.repeat(40), profile: 'qa', browser, model };
    const first = await runJourneys({ ...options, tasks: [task('contatos.cadastrar', { revision: 1 }), task('contatos.editar')] });
    const second = await runJourneys({ ...options, tasks: [task('contatos.cadastrar', { revision: 2 }), task('contatos.editar')] });
    assert.equal(serial, 2);
    assert.equal(edits, 2, JSON.stringify([first, second].map((run) => run.map((item) => [item.status, item.reason]))));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('robô confere GET autenticado direto e registra captura sanitizada após reload', async () => {
  let url = 'https://qa.test/bot/ref-1'; let calls = 0;
  const page = { url: () => url, async goto(next) { url = next; }, async reload() {},
    getByText: () => ({ async count() { return 1; } }), getByRole: () => ({ async count() { return 0; } }) };
  const result = await verifyUniqueRecord({ page, task: { id: 'robos.criar', modulo: 'robos' },
    refs: ['ref-1'], targetUrl: 'https://qa.test', name: fixtureValue('robotName'),
    expectedValue: fixtureValue('robotName'), getPersisted: async (path) => {
      assert.equal(path, '/bot/ref-1'); calls++;
      return { status: 200, body: { dados: { bot: { id: 7, idRef: 'ref-1', title: fixtureValue('robotName'), status: false, secret: 'never logged' } } } };
    } });
  assert.equal(result.confirmed, true);
  assert.equal(calls, 1);
  assert.deepEqual(result.persistedCapture, { status: 200, topKeys: ['dados'] });
  assert.equal(JSON.stringify(result).includes('never logged'), false);
});

test('alvos duplicados têm chaves de região e não clicam no desabilitado', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<header><button aria-label="Mais opções" disabled>⋮</button></header><main><table><tbody><tr><td><button aria-label="Mais opções" onclick="window.clicked=1">⋮</button></td></tr></tbody></table></main>');
    const observed = await observeJourneyDom(page, { vocabulary: ['Mais opções'] });
    assert.deepEqual(observed.controls.map((item) => item.name), ['Mais opções (cabeçalho)', 'Mais opções (linha 1)']);
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Mais opções (linha 1)' }, observed.targets, { vocabulary: ['Mais opções'] });
    assert.equal(await page.evaluate(() => window.clicked), 1);
  } finally { await browser.close(); }
});

test('tag existente da conta pode vincular somente contato criado', async () => {
  const loaded = await loadQaFixtureIds(async (path) => ({ dados: [{ id: path === '/tags' ? 41 : 1 }] }));
  assert.ok(loaded.fixedIds.tag.has(41));
  const request = (contact, tag) => ({ method: () => 'POST', url: () => 'https://qa.test/api/v2/contactTags/9',
    postData: () => JSON.stringify({ contatoId: contact, tagsId: tag }) });
  const context = { taskId: 'contatos.marcar_tags', apiOrigin: 'https://qa.test', createdIds: new Set([9]), fixedIds: loaded.fixedIds };
  assert.equal(journeyRequestAllowed(request(9, 41), context), true);
  assert.equal(journeyRequestAllowed(request(8, 41), context), false);
  assert.equal(journeyRequestAllowed(request(9, 42), context), false);
  const arrayRequest = (ids) => ({ ...request(9, 41), postData: () => JSON.stringify(ids.map((tagsId) => ({ contatoId: 9, tagsId }))) });
  assert.equal(journeyRequestAllowed(arrayRequest([41]), context), true);
  assert.equal(journeyRequestAllowed(arrayRequest([41, 42]), context), false);
  assert.equal(typeof runtime.newLinkedTag, 'function');
  assert.equal(runtime.newLinkedTag([{ tagsId: 41 }], new Set(), new Set([41])), 41);
  assert.equal(runtime.newLinkedTag([{ tagsId: 41 }], new Set([41]), new Set([41])), null);
  const direct = await loadQaFixtureIds(async (path) => path === '/tags' ? [{ id: 41 }] : { dados: [{ id: 1 }] });
  assert.ok(direct.fixedIds.tag.has(41));
});

test('item do menu preserva aria-label com capitalização do front', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button aria-label="Exportar contatos">Exportar Contatos</button><button aria-label="Importar contatos">Importar Contatos</button>');
    const observed = await observeJourneyDom(page, { vocabulary: ['Exportar Contatos', 'Importar Contatos'] });
    assert.deepEqual(observed.controls.map((item) => item.name), ['Exportar contatos', 'Importar contatos']);
  } finally { await browser.close(); }
});

test('exportação busca o marcador e exige somente linhas fictícias; limpar filtros é vedado', () => {
  assert.equal(typeof runtime.exportActionForScreen, 'function');
  const { exportActionForScreen } = runtime;
  const name = fixtureValue('contactName', 1, 'a1b2c3d4');
  assert.deepEqual(exportActionForScreen({ fields: [{ role: 'textbox', name: 'Buscar contato...', value: null }],
    controls: [], state: {} }, name), { type: 'fill', role: 'textbox', name: 'Buscar contato...', value: name });
  assert.equal(exportActionForScreen({ fields: [{ role: 'textbox', name: 'Buscar contato...', value: name }],
    controls: [{ role: 'checkbox', name: `Selecionar ${name}`, enabled: true, checked: false },
      { role: 'button', name: 'Mais opções (cabeçalho)', enabled: true }],
    state: { visibleRows: '1', generatedRows: '1' } }, name).name, `Selecionar ${name}`);
  assert.equal(exportActionForScreen({ fields: [{ role: 'textbox', name: 'Buscar contato...', value: name }],
    controls: [{ role: 'checkbox', name: `Selecionar ${name}`, enabled: true, checked: true },
      { role: 'button', name: 'Mais opções (cabeçalho)', enabled: true }],
    state: { visibleRows: '1', generatedRows: '1' } }, name).name, 'Mais opções (cabeçalho)');
  assert.equal(exportActionForScreen({ fields: [{ role: 'textbox', name: 'Buscar contato...', value: name }],
    controls: [{ role: 'menuitem', name: 'Exportar Contatos', enabled: true }],
    state: { visibleRows: '2', generatedRows: '1' } }, name), null);
  assert.equal(policyDecision({ type: 'click', role: 'button', name: 'Limpar filtros' }, new Set(), 'contatos.exportar').allowed, false);
});

test('importação anterior desabilitada aguarda com teto e registra o bloqueio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r12-import-'));
  let waited = 0; let decided = 0;
  try {
    const [record] = await runJourneys({ module: 'contatos', tasks: [task('contatos.importar')], root,
      frontSha: 'a'.repeat(40), profile: 'qa', browser: {
        async open() {}, async close() {}, async waitImportReady(ms) { waited = ms; return false; },
        async observe() { return { title: 'Contatos', path: '/contact', controls: [
          { role: 'button', name: 'Importar Contatos', enabled: false }], fields: [], messages: [], state: {},
        screenshot: Buffer.from('masked') }; } },
      model: { async decide() { decided++; return { type: 'finish' }; } } });
    assert.equal(record.importInProgress, true);
    assert.equal(record.reason, 'importação anterior em andamento');
    assert.equal(waited, 30_000);
    assert.equal(decided, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cobertura registra somente tipo estrutural do elemento', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button style="position:absolute;top:20px;left:20px">Mais</button><div class="toast secret-customer-name" role="alert" style="position:fixed;inset:0;background:#ddd">Dado privado</div>');
    const cover = await runtime.coveringElement(page, { selector: 'button', index: 0 });
    assert.deepEqual(cover, { tag: 'div', role: 'alert', fixedOverlay: true, backdrop: false,
      toast: true, thirdPartyWidget: false });
    assert.equal(JSON.stringify(cover).includes('Dado privado'), false);
    assert.equal(JSON.stringify(cover).includes('secret-customer-name'), false);
  } finally { await browser.close(); }
});

test('wrapper de browser repassa exportação determinística e espera de importação', async () => {
  const browser = runtime.makeLazyJourneyBrowser(() => ({
    async open() {}, async close() {}, async exportAction() { return 'export'; },
    async waitImportReady() { return true; },
  }));
  await browser.open();
  assert.equal(await browser.exportAction(), 'export');
  assert.equal(await browser.waitImportReady(), true);
  await browser.close();
});
