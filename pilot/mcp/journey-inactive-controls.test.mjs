import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { observeJourneyDom, actJourneyAction } from './journey-runtime.mjs';

const vocabulary = ['Nome', 'Telefone', 'Salvar', 'Excluir', 'Editar título do Robô'];
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
async function withPage(run) {
  const page = await browser.newPage();
  try { await run(page); }
  finally { await page.close(); }
}

test('observador reserva os campos para o formulário ativo com fundo inert', async () => {
  await withPage(async page => {
    await page.setContent(`<section inert>
      <button>Excluir</button>${'<input type="checkbox">'.repeat(24)}
    </section><div role="dialog"><form>
      <label>Nome<input name="nome"></label><label>Telefone<input name="telefone"></label>
      <button type="button" onclick="window.saved = true">Salvar</button>
    </form></div>`);
    const screen = await observeJourneyDom(page, { vocabulary });
    assert.deepEqual(screen.fields.map(f => f.name), ['Nome', 'Telefone']);
    assert.deepEqual(screen.controls.map(c => c.name), ['Nome', 'Telefone', 'Salvar']);
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Salvar' }, screen.targets, { vocabulary });
    assert.equal(await page.evaluate(() => window.saved), true,
      'o índice do alvo continua pertencendo à lista completa de nós do DOM');
  });
});

test('ação reobserva e recusa alvo que ganhou ancestral inert', async () => {
  await withPage(async page => {
    await page.setContent('<section><button onclick="window.deleted = true">Excluir</button></section>');
    const screen = await observeJourneyDom(page, { vocabulary });
    await page.locator('section').evaluate(n => n.setAttribute('inert', ''));
    const outcome = await actJourneyAction(page, { type: 'click', role: 'button', name: 'Excluir' },
      screen.targets, { vocabulary }).then(() => null, error => error.code);
    assert.equal(outcome, 'JOURNEY_TARGET_CHANGED');
    assert.equal(await page.evaluate(() => Boolean(window.deleted)), false);
  });
});

test('ícone acionável de Robô com aria-hidden continua disponível fora de inert', async () => {
  await withPage(async page => {
    await page.setContent('<div>Robô Exemplo 01<svg class="cursor-pointer" aria-hidden="true"'
      + ' width="20" height="20" onclick="window.edited = true"><rect width="20" height="20"/></svg></div>');
    const screen = await observeJourneyDom(page, { vocabulary });
    assert.equal(screen.controls.some(c => c.name === 'Editar título do Robô' && c.enabled), true);
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Editar título do Robô' },
      screen.targets, { vocabulary });
    assert.equal(await page.evaluate(() => window.edited), true);
  });
});

test('aria-hidden falso e remoção de inert preservam alvos legítimos', async () => {
  await withPage(async page => {
    await page.setContent('<section inert="false"><button>Excluir</button></section>'
      + '<section aria-hidden="false"><button onclick="window.saved = true">Salvar</button></section>');
    let screen = await observeJourneyDom(page, { vocabulary });
    assert.equal(screen.controls.some(c => c.name === 'Salvar'), true);
    await page.locator('[inert]').evaluate(n => n.removeAttribute('inert'));
    screen = await observeJourneyDom(page, { vocabulary });
    assert.equal(screen.controls.some(c => c.name === 'Excluir'), true);
    await actJourneyAction(page, { type: 'click', role: 'button', name: 'Salvar' }, screen.targets, { vocabulary });
    assert.equal(await page.evaluate(() => window.saved), true);
  });
});
