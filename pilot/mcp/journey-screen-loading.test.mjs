import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../scripts/visual/measure.mjs';
import { waitForStableScreen } from '../scripts/screen-capture/capture.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

async function withPage(html, run) {
  const page = await browser.newPage();
  try { await page.setContent(html); await run(page); }
  finally { await page.close(); }
}

const loader = '<svg width="200" height="72"><title>Carregando...</title><rect width="200" height="72" /></svg>';

test('captura espera o conteúdo carregado mesmo com geometria estável', async () => {
  await withPage(`<main style="width:300px;height:300px">${loader}</main>`, async page => {
    await page.evaluate(() => {
      setTimeout(() => { document.querySelector('main').innerHTML = '<button>Adicionar bloco</button>'; }, 350);
    });
    await waitForStableScreen(page);
    assert.equal(await page.getByRole('button', { name: 'Adicionar bloco' }).count(), 1,
      'a tela entregue ao observador precisa ter saído do carregamento');
  });
});

test('carregamento persistente não vira tela pronta por animação infinita', async () => {
  await withPage(`<style>@keyframes pulse {to {opacity:.5}} svg {animation:pulse 1s infinite}</style><main>${loader}</main>`, async page => {
    await assert.rejects(waitForStableScreen(page), /tela não estabilizou: carregamento/u);
  });
});

test('loader oculto ou inerte não impede observar controles ativos', async () => {
  for (const wrapper of ['hidden', 'style="visibility:hidden"', 'inert']) {
    await withPage(`<main><section ${wrapper}>${loader}</section><button>Salvar</button></main>`, async page => {
      const result = await waitForStableScreen(page);
      assert.equal(result.stable, true);
      assert.equal(await page.getByRole('button', { name: 'Salvar' }).isVisible(), true);
    });
  }
});

test('animação decorativa infinita e título de imagem não são carregamento', async () => {
  await withPage('<style>@keyframes pulse {to {opacity:.5}} svg {animation:pulse 1s infinite}</style><main><svg width="30" height="30"><title>Loading icon example</title></svg><button>Salvar</button></main>', async page => {
    assert.equal((await waitForStableScreen(page)).stable, true);
  });
});
