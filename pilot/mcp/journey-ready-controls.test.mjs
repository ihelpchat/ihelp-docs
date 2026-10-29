import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { waitForStableScreen } from '../scripts/screen-capture/capture.mjs';
import * as runtime from './journey-runtime.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

test('Robôs espera a busca na lista e a aba da ficha; outros módulos preservam a espera anterior', () => {
  assert.deepEqual(runtime.journeyReadinessControl?.('robos.buscar', '/bot') ?? null,
    { selector: 'input[placeholder="Buscar robô"]' });
  assert.deepEqual(runtime.journeyReadinessControl?.('robos.editar', '/bot/own-1') ?? null,
    { selector: 'a', text: 'Fluxo de Robô' });
  assert.equal(runtime.journeyReadinessControl?.('contatos.cadastrar', '/contact') ?? null, null);
});

test('tela inicialmente vazia só fica pronta depois da hidratação do controle necessário', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main style="width:300px;height:300px"></main>');
    await page.evaluate(() => {
      // Render after eight requested native frames, without racing an IPC timer.
      const frame = window.requestAnimationFrame.bind(window); let count = 0;
      window.requestAnimationFrame = callback => frame(time => {
        if (++count === 8) document.querySelector('main').innerHTML = '<input placeholder="Buscar robô">';
        callback(time);
      });
    });
    await waitForStableScreen(page, { readyControl: { selector: 'input[placeholder="Buscar robô"]' } });
    assert.equal(await page.getByPlaceholder('Buscar robô').count(), 1,
      'geometria estável antes da hidratação não deve encerrar a observação');
  } finally { await page.close(); }
});

test('controle inicial ausente ou inerte não vira pronto pelo fallback de animação infinita', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<style>@keyframes pulse {to {opacity:.5}} main {animation:pulse 1s infinite}</style><main><section inert><input placeholder="Buscar robô"></section></main>');
    await assert.rejects(waitForStableScreen(page, {
      readyControl: { selector: 'input[placeholder="Buscar robô"]' },
    }), /tela não estabilizou: controle inicial indisponível/u);
  } finally { await page.close(); }
});

test('controle visível correto libera a captura, sem alterar a chamada sem requisito', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<main><a>Outra aba</a><a>Fluxo de Robô</a></main>');
    assert.equal((await waitForStableScreen(page, { readyControl: { selector: 'a', text: 'Fluxo de Robô' } })).stable, true);
    assert.equal((await waitForStableScreen(page)).stable, true);
  } finally { await page.close(); }
});
