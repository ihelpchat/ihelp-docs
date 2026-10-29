import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { observeJourneyDom, actJourneyAction } from './journey-runtime.mjs';

const vocabulary = ['Nome', 'Telefone', 'Salvar', 'Excluir'];
async function withPage(run) {
  const browser = await launch();
  try { await run(await browser.newPage()); }
  finally { await browser.close(); }
}

for (const inactive of ['inert', 'aria-hidden="true"']) {
  test(`observador reserva os campos para o formulário ativo com fundo ${inactive}`, async () => {
    await withPage(async page => {
      await page.setContent(`<section ${inactive}>
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
}

test('ação reobserva e recusa alvo que ganhou ancestral aria-hidden', async () => {
  await withPage(async page => {
    await page.setContent('<section><button onclick="window.deleted = true">Excluir</button></section>');
    const screen = await observeJourneyDom(page, { vocabulary });
    await page.locator('section').evaluate(n => n.setAttribute('aria-hidden', 'true'));
    const outcome = await actJourneyAction(page, { type: 'click', role: 'button', name: 'Excluir' },
      screen.targets, { vocabulary }).then(() => null, error => error.code);
    assert.equal(outcome, 'JOURNEY_TARGET_CHANGED');
    assert.equal(await page.evaluate(() => Boolean(window.deleted)), false);
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
