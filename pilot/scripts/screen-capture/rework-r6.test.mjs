import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenshotFile } from '../../mcp/screenshot-files.mjs';
import { capturePlan, captureScreens, masksCoverSensitive } from './capture.mjs';
import { attachScreenshotsToArticle } from '../../mcp/screen-capture-manifest.mjs';
import { launch } from '../visual/measure.mjs';

const sha = 'a'.repeat(40);
const fact = (text, route) => ({ kind: 'action', text, route, owner: 'fixture', sha });

test('passos numerados de Relatórios, Contatos e Robôs mantêm a posição exata', async () => {
  for (const [file, module, route, labels] of [
    ['relatorios', 'Relatórios', '/relatorio', ['Relatórios', 'Filtrar', 'Aplicar Filtros']],
    ['agenda-de-contatos', 'Contatos', '/contact', ['Contatos', 'Importar Contatos']],
    ['robo-de-atendimento', 'Robôs', '/bot', ['Robôs', 'Criar novo Robô']],
  ]) {
    const body = await readFile(new URL(`../../content/docs/docs/sobre-o-sistema/${file}.mdx`, import.meta.url), 'utf8');
    const plan = capturePlan({ page: file, module, faqBody: body,
      coverage: [{ module, productRoutes: [route] }], screenFacts: labels.map((label) => fact(label, route)) });
    assert.deepEqual(plan.map((item) => item.label), labels);
    for (const item of plan) {
      assert.ok(Number.isInteger(item.listIndex) && item.listIndex >= 0);
      assert.ok(Number.isInteger(item.line) && item.line >= 0);
      assert.match(body.split('\n')[item.line], /^\d+[.)] /u);
      assert.match(body.split('\n')[item.line], new RegExp(item.label, 'iu'));
    }
  }
});

test('imagem de Robôs entra após o passo do plano, nunca na introdução', async () => {
  const body = await readFile(new URL('../../content/docs/docs/sobre-o-sistema/robo-de-atendimento.mdx', import.meta.url), 'utf8');
  const [step] = capturePlan({ page: 'robo-de-atendimento', module: 'Robôs', faqBody: body,
    coverage: [{ module: 'Robôs', productRoutes: ['/bot'] }], screenFacts: [fact('Robôs', '/bot')] });
  const file = screenshotFile(step.page, step.step, 'automatic', Buffer.from('fixture'), 'png');
  const manifest = { version: 1, entries: [{ ...step, source: 'automatic', masked: [], bundleSha: sha,
    sha256: file.split('.')[2], file }] };
  const article = attachScreenshotsToArticle({ path: 'docs/robo-de-atendimento', body }, manifest, sha,
    [fact('Robôs', '/bot')]);
  const imageAt = article.body.split('\n').findIndex((line) => line.includes(`](${file})`));
  assert.ok(imageAt > step.line);
  assert.match(article.body.split('\n')[imageAt - 2], /^1\. No menu do iHelp, abra \*\*Robôs\*\*/u);
});

test('dois retângulos sensíveis exigem duas máscaras', () => {
  const sensitive = [{ x: 10, y: 10, width: 30, height: 20 }, { x: 100, y: 10, width: 30, height: 20 }];
  assert.equal(masksCoverSensitive(sensitive, [sensitive[0]]), false);
});

test('mudança de texto após o screenshot descarta os dois candidatos', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<button>Abrir</button><p id="late"></p>');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r6-recheck-'));
  try {
    let calls = 0;
    const manifest = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true, root,
      plan: [{ page: 'contatos', step: 'abrir', role: 'button', label: 'Abrir', route: '/', action: 'none',
        alt: 'Abrir', owner: 'fixture', checkoutSha: sha }],
      fixtureAfterScreenshot: async (page) => {
        calls++;
        await page.evaluate(() => { document.getElementById('late').textContent += 'tardio@exemplo.com'; });
      } });
    assert.equal(calls, 2);
    assert.equal(manifest.entries.length, 0);
    assert.match(manifest.pending.join(' '), /print descartado/u);
    assert.deepEqual(await readdir(join(root, 'contatos')), []);
  } finally { await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true }); }
});

test('texto inserido depois do overlay nunca sai legível no PNG', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<style>body{font:24px monospace}button{position:absolute;top:10px}#late{position:absolute;left:20px;top:100px}</style>
      <button>Abrir</button><div id="late"></div><script>
      new MutationObserver(() => { if (document.querySelector('[data-screen-capture-overlay]') && !document.getElementById('late').textContent)
        document.getElementById('late').textContent = 'tardio@exemplo.com';
      }).observe(document.body, { childList: true, subtree: true });
      </script>`);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r6-'));
  try {
    const manifest = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true, root,
      plan: [{ page: 'contatos', step: 'abrir', role: 'button', label: 'Abrir', route: '/', action: 'none',
        alt: 'Abrir', owner: 'fixture', checkoutSha: sha }] });
    if (manifest.entries.length === 0) {
      assert.match(manifest.pending.join(' '), /print descartado/u);
      return;
    }
    const png = await readFile(join(root, 'contatos', manifest.entries[0].file.split('/').at(-1)));
    const browser = await launch();
    try {
      const page = await browser.newPage();
      const dark = await page.evaluate(async (data) => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(20, 100, 250, 35).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] < 80 && pixels[i + 1] < 80 && pixels[i + 2] < 80) count++;
        return count;
      }, `data:image/png;base64,${png.toString('base64')}`);
      assert.equal(dark, 0, 'e-mail tardio apareceu no PNG');
    } finally { await browser.close(); }
  } finally { await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true }); }
});
