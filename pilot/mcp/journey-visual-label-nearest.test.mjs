import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { observeJourneyDom } from './journey-runtime.mjs';

// Painel real "Encaminhar atendimento" (front-react StepServiceFollow, sha 3d76bb19): título da etapa em <label>,
// radios com <label for>, <label>Selecione o departamento</label>, select customizado role="combobox" sem associação
// explícita e rodapé com botões de texto. Mesma causa de rotulagem vista no registro R2 de robos.encaminhar:
// - controle sem associação explícita recebe o <label> precedente MAIS PRÓXIMO (o primeiro do grupo é o título da etapa);
// - botão com texto próprio legível é nomeado pelo texto, não pelo rótulo visual do ancestral;
// - prioridades explícitas (aria-labelledby, label[for], label envolvente, aria-label) e o fallback contextual do botão
//   só com ícone continuam como estão; labels adjacentes (título + dica) valem pelo primeiro.
const vocabulary = ['Encaminhar para um departamento ou atendente?', 'Departamento', 'Atendente',
  'Selecione o departamento', 'Cancelar', 'Adicionar bloco', 'Fechar painel', 'Nome', 'Telefone', 'Rotulado por aria',
  'Título do Robô', 'Canais', 'Adicione os canais permitidos:'];
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
  <div>
    <button type="button">Cancelar</button>
    <button type="button"><span>Adicionar bloco</span></button>
    <button type="button" aria-label="Fechar painel">×</button>
    <button type="button"><svg width="16" height="16"><rect width="16" height="16"/></svg></button>
  </div>
</div>`;

test('painel real: seletor recebe o label mais próximo, botões o próprio texto, aria/for e ícone preservados', async () => {
  await withPage(async (page) => {
    await page.setContent(panel);
    const screen = await observeJourneyDom(page, { vocabulary });
    const combobox = screen.controls.find((item) => item.role === 'combobox');
    assert.equal(combobox?.name, 'Selecione o departamento', 'select sem associação: label precedente mais próximo');
    assert.deepEqual(screen.controls.filter((item) => item.role === 'textbox').map((item) => [item.name, item.checked]),
      [['Departamento', true], ['Atendente', false]], 'label[for] continua acima do rótulo visual');
    const buttons = screen.controls.filter((item) => item.role === 'button').map((item) => item.name);
    assert.deepEqual(buttons, ['Cancelar', 'Adicionar bloco', 'Fechar painel', 'Selecione o departamento'],
      'texto próprio legível vence o rótulo visual; aria-label vence o texto; botão só com ícone mantém o fallback');
    assert.equal(screen.controls.some((item) => item.name.startsWith('Encaminhar para um departamento ou atendente?')),
      false, 'o título da etapa não nomeia controle algum');
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

test('título e dica adjacentes formam um só rótulo e valem pelo primeiro (preservação: Canais)', async () => {
  await withPage(async (page) => {
    await page.setContent(`<div>
      <label>Título do Robô</label><input placeholder="Digite o título do robô">
      <label>Canais</label><label>Adicione os canais permitidos:</label><div role="combobox" tabindex="0">Selecione</div>
    </div>`);
    const screen = await observeJourneyDom(page, { vocabulary });
    assert.equal(screen.controls.find((item) => item.role === 'combobox')?.name, 'Canais');
  });
});
