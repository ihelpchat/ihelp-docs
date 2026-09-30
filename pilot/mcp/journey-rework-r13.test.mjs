import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { runJourneys, fixtureValue, journeyCoverage, policyDecision } from './journey-service.mjs';
import * as runtime from './journey-runtime.mjs';

const contact = { id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'Criar contato', resultadoEsperadoObservavel: 'Contato criado' };

test('dica flutuante não intercepta o clique e botão de ícone usa título do wrapper', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div data-tooltip-content="Editar"><button onclick="window.clicked=1"><svg></svg></button></div><div role="tooltip" style="position:fixed;inset:0;z-index:999999">Editar</div>');
    assert.equal(typeof runtime.installJourneyTooltipStyle, 'function');
    await runtime.installJourneyTooltipStyle(page);
    const screen = await runtime.observeJourneyDom(page, { vocabulary: ['Editar'] });
    assert.ok(screen.controls.some((item) => item.role === 'button' && item.name === 'Editar'));
    await runtime.actJourneyAction(page, { type: 'click', role: 'button', name: 'Editar' }, screen.targets, { vocabulary: ['Editar'] });
    assert.equal(await page.evaluate(() => window.clicked), 1);
  } finally { await browser.close(); }
});

test('títulos estáticos de dica entram no vocabulário e excluir segue proibido', () => {
  assert.ok(runtime.journeyVocabulary([], [{ path: 'Screen.tsx', excerpt: '<CustomTooltip content="Editar" title="Salvar" />' }]).includes('Editar'));
  assert.equal(policyDecision({ type: 'click', role: 'menuitem', name: 'Excluir contato', value: null }).allowed, false);
});

test('busca aguarda GET filtrado e conclui só com uma linha e ref correspondente', async () => {
  const name = fixtureValue('contactName', 1, 'a1b2c3d4');
  const page = { waitForResponse: async (predicate) => ({ ok: () => true, url: () => 'https://qa.test/api/v2/contacts?page=1&searchData=' + encodeURIComponent(name),
    request: () => ({ method: () => 'GET' }), json: async () => ({ dados: [{ nome: name, idRef: 'ref-1' }] }) }) };
  assert.equal(typeof runtime.verifyFilteredContactSearch, 'function');
  assert.deepEqual(await runtime.verifyFilteredContactSearch(page, name, 'ref-1'), { confirmed: true, observed: 'Contato fictício localizado de forma única' });
});

test('cobertura separa importação bloqueada pelo ambiente', () => {
  assert.deepEqual(journeyCoverage([{ task: 'contatos.importar', status: 'bloqueada', reason: 'ambiente: importação anterior em andamento' },
    { task: 'contatos.cadastrar', status: 'concluída' }]), { completed: 1, eligible: 1, percent: 100,
    environmentBlocked: [{ task: 'contatos.importar', reason: 'ambiente: importação anterior em andamento' }] });
});

test('conta B reexecuta criação antes de usar cache da conta A', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r13-account-'));
  let opens = 0; let account = 'a'; let entered;
  const marker = 'a1b2c3d4';
  const browser = { async open() { opens++; entered = new Map(); }, async close() {},
    async observe() { return { title: 'Contatos', path: '/contact', controls: [{ role: 'button', name: 'Salvar', enabled: true }],
      fields: [{ role: 'textbox', name: 'Nome', value: entered.get('Nome') ?? null },
        { role: 'textbox', name: 'Telefone', value: entered.get('Telefone') ?? null }], messages: [], state: {}, screenshot: Buffer.from('masked') }; },
    async act(action) { if (action.type === 'fill') entered.set(action.name, action.value); },
    async awaitCreation() { return { capture: { postSeen: true, status: 200, refFound: true }, ref: `ref-${opens}` }; },
    async verify() { return { confirmed: true, observed: 'feito', created: { contact: fixtureValue('contactName', 1, marker) },
      identity: { refs: [`ref-${opens}`], ids: [opens] } }; } };
  const model = { async decide({ actions }) { return [
    { type: 'fill', role: 'textbox', name: 'Nome', value: fixtureValue('contactName', 1, marker) },
    { type: 'fill', role: 'textbox', name: 'Telefone', value: fixtureValue('phone', 1, marker) },
    { type: 'click', role: 'button', name: 'Salvar', value: null }][actions.length]; } };
  try {
    const options = { module: 'contatos', tasks: [contact], root, marker, frontSha: 'a'.repeat(40), profile: 'qa', browser, model,
      accountIdentity: async () => ({ userId: 'user-' + account, companyId: 'company-' + account }) };
    const [first] = await runJourneys(options);
    assert.equal(first.status, 'concluída');
    account = 'b';
    await runJourneys(options);
    assert.equal(opens, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
