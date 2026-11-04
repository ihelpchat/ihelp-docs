import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { observeJourneyDom } from './journey-runtime.mjs';

// Estrutura real do painel "Encaminhar atendimento" (front-react StepServiceFollow, sha 3d76bb19): título da etapa
// em <label>, radios com <label for>, depois <label>Selecione o departamento</label> e um select customizado
// role="combobox" sem associação explícita. O rótulo visual de um controle sem associação é o <label> precedente
// MAIS PRÓXIMO; o primeiro <label> do grupo nomeia a etapa, não o controle. Prioridades explícitas
// (aria-labelledby, label[for], label envolvente, aria-label) continuam acima do rótulo visual.
const vocabulary = ['Encaminhar para um departamento ou atendente?', 'Departamento', 'Atendente',
  'Selecione o departamento', 'Cancelar', 'Adicionar bloco', 'Nome', 'Telefone', 'Rotulado por aria'];
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });
async function withPage(run) {
  const page = await browser.newPage();
  try { await run(page); }
  finally { await page.close(); }
}
const panel = `<div class="px-6 py-2">
  <label>Encaminhar para um departamento ou atendente?</label>
  <fieldset><legend>Notification method</legend>
    <div><input id="department" name="notification-method" type="radio" checked><label for="department">Departamento</label></div>
    <div><input id="servicer" name="notification-method" type="radio"><label for="servicer">Atendente</label></div>
  </fieldset>
  <label>Selecione o departamento</label>
  <div class="relative"><div role="combobox" aria-expanded="false" aria-haspopup="listbox" tabindex="0"><span>Selecione uma opção</span></div></div>
  <div><button type="button">Cancelar</button><button type="button">Adicionar bloco</button></div>
</div>`;

test('select customizado sem associação explícita recebe o label precedente mais próximo, não o título da etapa', async () => {
  await withPage(async (page) => {
    await page.setContent(panel);
    const screen = await observeJourneyDom(page, { vocabulary });
    const combobox = screen.controls.find((item) => item.role === 'combobox');
    assert.equal(combobox?.name, 'Selecione o departamento');
    assert.deepEqual(screen.controls.filter((item) => item.role === 'textbox').map((item) => [item.name, item.checked]),
      [['Departamento', true], ['Atendente', false]], 'label[for] continua acima do rótulo visual');
    assert.equal(screen.controls.some((item) => item.name === 'Encaminhar para um departamento ou atendente?'
      && item.role === 'combobox'), false, 'o título da etapa não nomeia o select');
  });
});

test('entre vizinhos sem associação, cada campo recebe o label imediatamente anterior', async () => {
  await withPage(async (page) => {
    await page.setContent(`<div>
      <span id="aria-nome">Rotulado por aria</span>
      <label>Nome</label><input type="text" aria-labelledby="aria-nome">
      <label>Telefone</label><input type="tel">
    </div>`);
    const screen = await observeJourneyDom(page, { vocabulary });
    assert.deepEqual(screen.fields.map((item) => item.name), ['Rotulado por aria', 'Telefone']);
  });
});
