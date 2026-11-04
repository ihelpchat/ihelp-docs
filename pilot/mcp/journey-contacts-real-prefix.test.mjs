import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { waitForStableScreen } from '../scripts/screen-capture/capture.mjs';
import { exportActionForScreen, journeyReadinessControl, observeJourneyDom } from './journey-runtime.mjs';
import { fixtureValue, realCompanyFixture } from './journey-service.mjs';
import { containsSensitiveData } from './sensitive-data.mjs';

// Shapes copied from the sanitized production record of contatos.exportar/buscar (03/11, marker b857ea52).
const marker = 'b857ea52';
const realName = realCompanyFixture('contactName', 1, marker, '+442079460099');
const legacyName = fixtureValue('contactName', 1, marker);
const vocabulary = ['Selecionar todos os contatos', 'Mais opções', 'Contatos'];

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const listPage = (search, rows) => `<main>
  <input placeholder="Buscar contato..." value="${search}">
  <button>Mais opções</button>
  <table><thead><tr><th><input type="checkbox" aria-label="Selecionar todos os contatos"></th></tr></thead>
  <tbody>${rows.map((name) => `<tr><td><input type="checkbox" aria-label="Selecionar ${name}"></td><td>${name}</td></tr>`).join('')}</tbody>
  </table></main>`;

async function observeList(search, rows, generated) {
  const page = await browser.newPage();
  try {
    await page.setContent(listPage(search, rows));
    return await observeJourneyDom(page, { vocabulary, generated });
  } finally { await page.close(); }
}

test('empresa real: linha filtrada com prefixo Teste FAQ conta como fictícia e libera a seleção exata', async () => {
  assert.ok(realName.startsWith('Teste FAQ Contato Exemplo 01'));
  const screen = await observeList(realName, [realName], new Set([realName]));
  assert.equal(screen.state.visibleRows, '1');
  assert.equal(screen.state.generatedRows, '1', 'linha do contato fictício da empresa real não foi reconhecida');
  assert.ok(screen.controls.some((control) => control.role === 'checkbox' && control.name === `Selecionar ${realName}`),
    'checkbox da linha fictícia virou campo opaco');
  assert.deepEqual(exportActionForScreen(screen, realName, [], realName),
    { type: 'click', role: 'checkbox', name: `Selecionar ${realName}`, value: null });
});

test('nome do checkbox real passa pela mesma checagem de gravação que o legado', () => {
  // journey-service.mjs safeJourney rejects any recorded string flagged here.
  assert.equal(containsSensitiveData(`Selecionar ${legacyName}`, { detectOpaque: true }), false);
  assert.equal(containsSensitiveData(`Selecionar ${realName}`, { detectOpaque: true }), false);
});

test('controle legado (homologação, sem prefixo) mantém o mesmo comportamento', async () => {
  const screen = await observeList(legacyName, [legacyName], new Set([legacyName]));
  assert.equal(screen.state.generatedRows, '1');
  assert.deepEqual(exportActionForScreen(screen, legacyName, [], legacyName),
    { type: 'click', role: 'checkbox', name: `Selecionar ${legacyName}`, value: null });
});

test('guarda: cliente real e fictício de outra execução continuam fora da seleção', async () => {
  const other = realCompanyFixture('contactName', 2, marker, '+442079460099');
  const screen = await observeList(realName, ['Maria Cliente Real', other], new Set([realName]));
  assert.equal(screen.state.visibleRows, '2');
  assert.equal(screen.state.generatedRows, '0');
  assert.ok(!screen.controls.some((control) => /Maria Cliente Real|Exemplo 02/u.test(control.name)));
  assert.equal(exportActionForScreen(screen, realName, [], realName), null);
  const prefixOnly = await observeList(realName, ['Teste FAQ Cliente Real'], new Set([realName]));
  assert.equal(prefixOnly.state.generatedRows, '0');
  assert.ok(!prefixOnly.controls.some((control) => control.name === 'Selecionar Teste FAQ Cliente Real'));
});

test('buscar/exportar esperam o campo de busca da lista; demais tarefas preservam a espera anterior', () => {
  const ready = { selector: 'input[placeholder="Buscar contato..."]' };
  assert.deepEqual(journeyReadinessControl('contatos.buscar', '/contact'), ready);
  assert.deepEqual(journeyReadinessControl('contatos.exportar', '/contact'), ready);
  assert.equal(journeyReadinessControl('contatos.cadastrar', '/contact'), null);
  assert.equal(journeyReadinessControl('contatos.buscar', '/contact/detail/own-1'), null);
  assert.equal(journeyReadinessControl('contatos.editar', '/contact/detail/own-1'), null);
});

test('lista de Contatos hidratada depois do layout estável: a observação de buscar já enxerga o campo', async () => {
  const page = await browser.newPage();
  try {
    // Mirrors buscar[0] in production: menu rendered, list toolbar still missing.
    await page.setContent('<main style="width:300px;height:300px"><button>Contatos</button><div id="list"></div></main>');
    await page.evaluate(() => {
      const frame = window.requestAnimationFrame.bind(window); let count = 0;
      window.requestAnimationFrame = callback => frame(time => {
        if (++count === 8) document.getElementById('list').innerHTML = '<input placeholder="Buscar contato...">';
        callback(time);
      });
    });
    await waitForStableScreen(page, { readyControl: journeyReadinessControl('contatos.buscar', '/contact') });
    const screen = await observeJourneyDom(page, { vocabulary, generated: new Set([realName]) });
    assert.ok(screen.fields.some((field) => field.role === 'textbox' && field.name === 'Buscar contato...'),
      'buscar observou a lista antes do campo de busca existir');
  } finally { await page.close(); }
});
