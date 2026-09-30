import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { waitForStableScreen } from '../scripts/screen-capture/capture.mjs';
import { fixtureValue } from './journey-service.mjs';
import * as runtime from './journey-runtime.mjs';

test('criação usa apenas a ref do POST da tarefa; dependentes abrem a ficha', () => {
  assert.equal(typeof runtime.creationRefsForTask, 'function');
  const { creationRefsForTask, journeyStartRoute } = runtime;
  assert.deepEqual(creationRefsForTask('robos.criar', ['old-ref', 'new-ref'], 'new-ref'), ['new-ref']);
  assert.deepEqual(creationRefsForTask('robos.criar', ['old-ref'], null), []);
  assert.deepEqual(creationRefsForTask('robos.editar', ['old-ref'], null), ['old-ref']);
  assert.equal(journeyStartRoute({ id: 'contatos.editar', modulo: 'contatos' }, { identity: { refs: ['contact-ref'], ids: [] } }), '/contact/detail/contact-ref');
  assert.equal(journeyStartRoute({ id: 'robos.montar_menu', modulo: 'robos' }, { robotRef: 'bot-ref', identity: { refs: ['bot-ref'], ids: [12] } }), '/bot/bot-ref');
});

test('ficha de canal selecionada não pode ser desmarcada por segundo clique', () => {
  assert.equal(typeof runtime.selectedRobotChannel, 'function');
  const { selectedRobotChannel } = runtime;
  const actions = [{ type: 'click', name: 'Canais', role: 'button' },
    { type: 'click', name: 'opção 1', role: 'option' }];
  assert.equal(selectedRobotChannel(actions), 'opção 1');
  assert.equal(selectedRobotChannel([...actions, { type: 'click', name: 'opção 1', role: 'option' }]), null);
});

test('animação infinita não impede estabilização; animação finita e layout móvel aguardam', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main style="width:300px;height:100px"></main><style>main{animation:pulse 1s infinite}@keyframes pulse{from{opacity:1}to{opacity:.5}}</style>');
    await waitForStableScreen(page);
    await page.setContent('<main style="height:100px"></main><style>main{animation:pulse 1s infinite alternate}@keyframes pulse{from{width:200px}to{width:400px}}</style>');
    assert.equal((await waitForStableScreen(page)).limit, 'animações infinitas');
  } finally { await browser.close(); }
});

test('importação registra só status e contagens e aguarda os dois nomes pela API', async () => {
  assert.equal(typeof runtime.importResponseCapture, 'function');
  const { importResponseCapture, verifyImportedContacts } = runtime;
  const capture = await importResponseCapture({ status: () => 200, ok: () => true,
    json: async () => ({ dados: { total: 2, failed: 0, name: 'segredo', token: 'secret' } }) });
  assert.deepEqual(capture, { postSeen: true, status: 200, counts: { total: 2, failed: 0 } });
  let calls = 0;
  const names = [fixtureValue('contactName', 2), fixtureValue('contactName', 3)];
  const result = await verifyImportedContacts({ names, timeoutMs: 1000, pollMs: 1,
    lookup: async (name) => { calls++; return calls <= 2 ? [] : [{ nome: name }]; } });
  assert.equal(result.confirmed, true);
  assert.equal(result.foundCount, 2);
});

test('exportação aceita só linhas com nomes fictícios selecionados', () => {
  assert.equal(typeof runtime.verifyExportRows, 'function');
  const row = (n, sharedIndex) => `<row r="${n}"><c r="A${n}" t="s"><v>${sharedIndex}</v></c></row>`;
  const names = [fixtureValue('contactName'), 'Cliente real'];
  const allowed = new Set([names[0]]);
  assert.equal(runtime.verifyExportRows(row(6, 0), names, allowed), true);
  assert.equal(runtime.verifyExportRows(row(6, 0) + row(7, 1), names, allowed), false);
  assert.equal(runtime.verifyExportRows(row(6, 1), names, allowed), false);
});
