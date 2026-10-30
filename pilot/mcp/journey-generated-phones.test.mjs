import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { observeJourneyDom } from './journey-runtime.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
async function observePhone(expected, displayed) {
  const page = await browser.newPage();
  try {
    await page.setContent('<label>Telefone<input type="tel"></label>');
    // React controlled inputs may update both value and defaultValue after formatting.
    await page.locator('input').evaluate((node, value) => { node.value = value; node.defaultValue = value; }, displayed);
    const screen = await observeJourneyDom(page, { vocabulary: ['Telefone'], generated: new Set([expected]) });
    return screen.fields.find(field => field.name === 'Telefone');
  } finally { await page.close(); }
}

test('telefone gerado fora do formato legado conserva identidade após máscara visual', async () => {
  const expected = '+1 202 555 0100';
  const field = await observePhone(expected, '+1 (202) 555-0100');
  assert.equal(field.value, expected, 'retorna somente o valor já autorizado, nunca o texto bruto');
  assert.equal(field.filled, true, 'formatação do input controlado não torna o campo vazio');
});

test('telefone legado reformatado também permanece preenchido no input controlado', async () => {
  const expected = '+44 20 7946 0001';
  const field = await observePhone(expected, '+44 (20) 7946-0001');
  assert.equal(field.value, expected);
  assert.equal(field.filled, true);
});

test('telefone gerado com valor exato preserva o comportamento anterior', async () => {
  const expected = '+44 20 7946 0001';
  const field = await observePhone(expected, expected);
  assert.equal(field.value, expected);
  assert.equal(field.filled, true);
});

test('telefone desconhecido, incompleto ou com dígito divergente não vira valor autorizado', async () => {
  for (const displayed of ['+1 (202) 555-0101', '+44 20 7946 0001', '+1', '']) {
    const field = await observePhone('+1 202 555 0100', displayed);
    assert.equal(field.value, null, displayed);
    assert.equal(field.filled, false, displayed);
  }
});
