import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { observeJourneyDom, actJourneyAction } from './journey-runtime.mjs';
import { nextAreaAction, verifyAreaResult } from './journey-plans/index.mjs';

// Estrutura: front 133ac38, CreateCardModal/index.tsx:1297-1337,1506-1527;
// TaskDrawer/index.tsx:391-415 e SelectCommon/Option.tsx (data-value).
const fixture = { cardName: 'Card Exemplo 01', stageName: 'Etapa Exemplo 02',
  contactSearch: 'Contato Exemplo 01', contactOption: 'opção 1', selfLabel: 'Atendente Exemplo 02' };
const vocabulary = ['Título do card', 'Estágio inicial', 'Responsável', 'Salvar',
  'Buscar por nome, telefone ou e-mail...'];
const click = (role, name) => ({ type: 'click', role, name, value: null });
const taskStart = [click('button', 'Nova Tarefa'),
  { type: 'fill', role: 'textbox', name: 'Título', value: 'Tarefa Exemplo 01' }];

test('CRM observa chips reais sob labels e escolhe a etapa e o responsável certos', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div role="dialog"><div><label>Estágio inicial</label><div>
      <button title="Etapa Exemplo 01"><span>Etapa Exemplo 01</span><div>0 cards</div></button>
      <button title="Etapa Exemplo 02"><span>Etapa Exemplo 02</span><div>1 card</div></button>
      </div></div><div><label>Responsável <span>*</span></label><div><div>
      <button title="Atendente Exemplo 01"><span>AE</span><span>Atendente Exemplo 01</span></button>
      <button title="Atendente Exemplo 02"><span>AE</span><span>Atendente Exemplo 02</span></button>
      </div></div></div></div>`);
    const actions = [click('button', 'Adicionar oportunidade'),
      { type: 'fill', role: 'textbox', name: 'Título do card', value: fixture.cardName }];
    const observe = () => observeJourneyDom(page, { vocabulary, generated: new Set(Object.values(fixture)) });
    let screen = await observe();
    let action = nextAreaAction('crm.criar_card', screen, actions, (kind) => fixture[kind]);
    assert.deepEqual(action, click('button', fixture.stageName));
    await actJourneyAction(page, action, screen.targets, { vocabulary, generated: new Set(Object.values(fixture)) });
    actions.push(action, click('combobox', 'Buscar por nome, telefone ou e-mail...'),
      { type: 'fill', role: 'combobox', name: 'Buscar por nome, telefone ou e-mail...', value: fixture.contactSearch },
      click('option', 'opção 1'));
    screen = await observe();
    action = nextAreaAction('crm.criar_card', screen, actions, (kind) => fixture[kind]);
    assert.deepEqual(action, click('button', fixture.selfLabel));
    await actJourneyAction(page, action, screen.targets, { vocabulary, generated: new Set(Object.values(fixture)) });
  } finally { await browser.close(); }
});

test('Tarefas usa o ID da sessão em qualquer posição e recusa opção ausente, duplicada ou trocada', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    for (const ids of [[8, 3], [3, 8], [8, 9, 3], [8, 9], [3, 3]]) {
      await page.setContent(`<div><label>Responsável *</label><div><div role="combobox" aria-expanded="false">Selecione o responsável</div></div></div>
        <div id="portal" style="display:none">${ids.map((id) => `<div data-value="${id}"><span>Nome Pessoal ${id}</span></div>`).join('')}</div>
        <script>document.querySelector('[role="combobox"]').onmousedown = () => {
          document.querySelector('#portal').style.display='block';
        }; document.querySelectorAll('[data-value]').forEach(el => el.onclick = () => {
          document.body.dataset.chosen=el.dataset.value;
          document.querySelector('#portal').style.display='none';
        });</script>`);
      const scope = { vocabulary, selfId: 3 };
      let screen = await observeJourneyDom(page, scope);
      const actions = [...taskStart];
      const fixtureFor = (kind) => kind === 'taskName' ? 'Tarefa Exemplo 01' : 'opção 1'; // valor antigo deliberadamente errado
      let action = nextAreaAction('tarefas.criar', screen, actions, fixtureFor);
      assert.deepEqual(action, click('combobox', 'Responsável'));
      await actJourneyAction(page, action, screen.targets, scope);
      actions.push(action);
      screen = await observeJourneyDom(page, scope);
      const anonymous = await observeJourneyDom(page, { vocabulary });
      assert.equal(nextAreaAction('tarefas.criar', anonymous, actions, fixtureFor), null);
      assert.equal(JSON.stringify(screen).includes('Nome Pessoal'), false);
      action = nextAreaAction('tarefas.criar', screen, actions, fixtureFor);
      if (ids.filter((id) => id === 3).length !== 1) {
        assert.equal(action, null);
        continue;
      }
      assert.deepEqual(action, click('option', `opção ${ids.indexOf(3) + 1}`));
      // Entre observação e clique, a ordem pode mudar. Não clicar em outro usuário.
      await page.locator('#portal').evaluate((menu) => menu.prepend(menu.lastElementChild));
      await assert.rejects(actJourneyAction(page, action, screen.targets, scope),
        { code: 'JOURNEY_TARGET_CHANGED' });
      screen = await observeJourneyDom(page, scope);
      action = nextAreaAction('tarefas.criar', screen, actions, fixtureFor);
      await actJourneyAction(page, action, screen.targets, scope);
      assert.equal(await page.locator('body').getAttribute('data-chosen'), '3');
      actions.push(action);
      await page.evaluate(() => { const button = document.createElement('button'); button.textContent = 'Salvar'; document.body.append(button); });
      screen = await observeJourneyDom(page, scope);
      assert.deepEqual(nextAreaAction('tarefas.criar', screen, actions, fixtureFor), click('button', 'Salvar'));
    }
  } finally { await browser.close(); }
});

test('criação só confirma persistência com responsável igual ao ID da sessão', () => {
  for (const [task, path, title, field] of [
    ['tarefas.criar', '/task', 'Tarefa Exemplo 01', 'assigneeUserId'],
    ['crm.criar_card', '/crm/card/11', 'Card Exemplo 01', 'responsibleId'],
  ]) {
    const context = { apiOrigin: 'https://api.example.test', createdIds: new Set([11]),
      generated: new Set([title]), fixedIds: { self: new Set([3]) } };
    const read = { method: 'GET', status: 200, url: `https://api.example.test/api/v2${path}` };
    for (const id of [3, 8, undefined]) {
      assert.equal(verifyAreaResult(task, { ...read, body: [{ id: 11, title, [field]: id }] }, context), id === 3);
    }
    assert.equal(verifyAreaResult(task, { ...read, body: [{ id: 11, title, [field]: 3 }] },
      { ...context, fixedIds: {} }), false);
  }
});
