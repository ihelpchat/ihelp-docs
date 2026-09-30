import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import * as runtime from './journey-runtime.mjs';
import { policyDecision } from './journey-service.mjs';

const vocabulary = ['Adicionar novo contato', 'Nome', 'Telefone', 'Email', 'Data de Nascimento',
  'Tags', 'Salvar', 'Canais', 'Título do Robô', 'Digite o título do robô', 'Buscar...'];
const generated = new Set(['Contato Exemplo 01', '+44 20 7946 0000', 'Robô Exemplo 01']);

test('formulários do produto ficam observáveis sem expor dados da conta', async () => {
  assert.equal(typeof runtime.observeJourneyDom, 'function');
  assert.equal(typeof runtime.actJourneyAction, 'function');
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button id="open">Adicionar Contato</button>
      <div id="modal" style="display:none;transition:opacity .05s"><form>
        <h2>Adicionar novo contato</h2>
        <div><label>Nome</label><div><input placeholder="Nome do contato" required></div></div>
        <div><label>Telefone*</label><div class="phoneInputWrapper"><button type="button">+44</button><input class="PhoneInputInput" type="tel"></div></div>
        <div><label>Email</label><input type="email"></div>
        <div><input type="text" value="segredo da conta"></div>
        <div><label>Tags</label><div role="combobox" tabindex="0">Selecione as tags</div></div>
        <button type="button" id="save">Salvar</button>
      </form></div>
      <div id="robot" style="display:none"><form>
        <div><label>Título do Robô</label><input placeholder="Digite o título do robô" required></div>
        <div><label>Canais</label><label>Adicione os canais permitidos:</label><div role="combobox" tabindex="0">Selecione uma opção</div></div>
        <div id="options" style="display:none"><input placeholder="Buscar..."><div data-value="17">Canal da conta privada</div><div data-value="23">Outro canal privado</div></div>
      </form></div>`);
    await page.locator('#open').evaluate((node) => {
      node.onclick = () => { document.querySelector('#modal').style.display = 'block'; };
    });
    await page.locator('#open').click();
    await page.waitForTimeout(80);
    const contact = await runtime.observeJourneyDom(page, { vocabulary, generated });
    assert.ok(contact.fields.some((field) => field.name === 'Nome' && field.required));
    assert.ok(contact.fields.some((field) => field.name === 'Telefone' && field.role === 'textbox' && field.required));
    assert.ok(contact.fields.some((field) => field.name === 'Tags' && field.role === 'combobox'));
    assert.ok(contact.fields.some((field) => /^campo \d+ do formulário/u.test(field.name)), JSON.stringify(contact.fields));
    assert.doesNotMatch(JSON.stringify(contact.fields), /segredo da conta/u);
    await runtime.actJourneyAction(page, { type: 'fill', role: 'textbox', name: 'Telefone', value: '+44 20 7946 0000' }, contact.targets);
    assert.equal(await page.locator('input[type=tel]').inputValue(), '+44 20 7946 0000');
    await page.locator('#modal').evaluate((node) => { node.style.display = 'none'; });
    await page.locator('#robot').evaluate((node) => { node.style.display = 'block'; });
    let robot = await runtime.observeJourneyDom(page, { vocabulary, generated });
    assert.ok(robot.fields.some((field) => field.name === 'Título do Robô'));
    assert.ok(robot.fields.some((field) => field.name === 'Canais' && field.role === 'combobox'));
    await runtime.actJourneyAction(page, { type: 'click', role: 'combobox', name: 'Canais', value: null }, robot.targets);
    await page.locator('#options').evaluate((node) => { node.style.display = 'block'; });
    await page.locator('[data-value]').evaluateAll((nodes) => nodes.forEach((node) => {
      node.onclick = () => node.setAttribute('data-selected', 'true');
    }));
    robot = await runtime.observeJourneyDom(page, { vocabulary, generated });
    assert.deepEqual(robot.controls.filter((control) => control.role === 'option').map((control) => control.name), ['opção 1', 'opção 2']);
    assert.doesNotMatch(JSON.stringify({ controls: robot.controls, fields: robot.fields }), /Canal da conta privada|Outro canal privado/u);
    await runtime.actJourneyAction(page, { type: 'click', role: 'option', name: 'opção 2', value: null }, robot.targets);
    assert.equal(await page.locator('[data-value="23"]').getAttribute('data-selected'), 'true');
  } finally { await browser.close(); }
});

test('ficha opaca é aceita somente como opção clicável', () => {
  assert.equal(policyDecision({ type: 'click', role: 'option', name: 'opção 1', value: null }).allowed, true);
  assert.equal(policyDecision({ type: 'select', role: 'combobox', name: 'Canais', value: 'Canal da conta privada' }).allowed, false);
});

test('vocabulário dos prints inclui rótulos e validações extraídos do front', () => {
  assert.deepEqual(runtime.journeyVocabulary([
    { text: 'Telefone', message: 'Informe o telefone com DDD' },
    { text: 'Canais' }, { text: 'Telefone' },
  ], [{ path: 'Form.tsx', excerpt: `export const Form = () => <form><label>Nome</label><input placeholder="Nome do contato" /></form>;
    function validate() { return 'O nome é obrigatório'; }` }]),
  ['Telefone', 'Informe o telefone com DDD', 'Canais', 'Nome', 'Nome do contato', 'O nome é obrigatório']);
});
