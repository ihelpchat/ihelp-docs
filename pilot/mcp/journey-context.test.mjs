import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import * as runtime from './journey-runtime.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
async function withContext(html, run) {
  const context = await (runtime.createJourneyContext?.(browser)
    ?? browser.newContext({ serviceWorkers: 'block', acceptDownloads: true }));
  try {
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.name));
    await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, { waitUntil: 'domcontentloaded' });
    await run(page, errors);
  } finally { await context.close(); }
}

test('contexto instala a proteção de tooltip após o documento existir, sem erro de bootstrap', async () => {
  await withContext('<main><button>Salvar</button></main>', async (page, errors) => {
    const installed = await page.evaluate(() => [...document.querySelectorAll('style')]
      .some(style => style.textContent.includes('[role="tooltip"]') && style.textContent.includes('pointer-events: none')));
    assert.equal(installed, true, 'o estilo deve existir no documento navegado');
    assert.deepEqual(errors, []);
  });
});

test('tooltip não intercepta o controle; a automação continua usando clique normal', async () => {
  await withContext('<button onclick="window.clicked=true">Salvar</button><div role="tooltip" style="position:fixed;inset:0;z-index:9999">Ajuda</div>', async page => {
    const clicked = await page.getByRole('button', { name: 'Salvar' }).click({ timeout: 4000 }).then(() => true, () => false);
    assert.equal(clicked, true);
    assert.equal(await page.evaluate(() => window.clicked === true), true);
  });
});

test('contexto desktop permite editar sem a coluna de atividade cobrir o ícone', async () => {
  await withContext('<style>body{margin:0}header{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.title{display:flex;align-items:center;justify-content:flex-end}.right{display:flex;justify-content:flex-end}.activity{width:640px;flex-shrink:0;white-space:nowrap}</style><header><div></div><div class="title">Robô Exemplo 01<svg aria-hidden="true" class="cursor-pointer" width="24" height="24" onclick="window.edited=true"><rect width="24" height="24" /></svg></div><div class="right"><span class="activity">Última atividade</span></div></header>', async page => {
    const observed = await runtime.observeJourneyDom(page, { vocabulary: ['Editar título do Robô'] });
    const clicked = await runtime.actJourneyAction(page, {
      type: 'click', role: 'button', name: 'Editar título do Robô', value: null,
    }, observed.targets, { vocabulary: ['Editar título do Robô'] }).then(() => true, () => false);
    assert.equal(clicked, true, 'não usar force nem ocultar a informação que cobre o ícone');
    assert.equal(await page.evaluate(() => window.edited === true), true);
  });
});

test('aria-hidden no log não transforma interceptação de ponteiro em controle invisível', () => {
  assert.equal(runtime.journeyActionCategory(new Error('locator.click: <svg aria-hidden="true">; <span> intercepts pointer events')), 'coberto');
  assert.equal(runtime.journeyActionCategory(new Error('element is not visible')), 'invisível');
  assert.equal(runtime.journeyActionCategory(new Error('hidden')), 'invisível');
});
