import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addUploadedScreenshot, capturePlan, captureScreens, chooseScreenshot } from './capture.mjs';
import { launch } from '../visual/measure.mjs';
import { attachScreenshotsToArticle, screenshotForStep } from '../../mcp/screen-capture-manifest.mjs';

const appSha = 'a'.repeat(40);
const coverage = [{ module: 'Contatos', productRoutes: ['/contact'] }];
const screenFacts = [
  { kind: 'action', text: 'Adicionar contato', owner: 'ContactPage', sha: appSha },
  { kind: 'action', text: 'Salvar contato', owner: 'ContactPage', sha: appSha },
];
const steps = [
  { id: 'abrir', role: 'button', label: 'Adicionar contato', route: '/contact', action: 'click' },
  { id: 'salvar', role: 'button', label: 'Salvar contato', route: '/contact' },
];

test('fixture local: rota, clique, destaque, máscara e manifesto', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><button id="open">Adicionar contato</button>
      <p>cliente@exemplo.com</p>
      <table><tbody><tr><td>Nome Particular</td></tr></tbody></table>
      <button id="save" hidden>Salvar contato</button><script>
      document.getElementById('open').onclick=()=>document.getElementById('save').hidden=false;
      </script></body></html>`);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const root = await mkdtemp(join(tmpdir(), 'screen-capture-'));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const plan = capturePlan({ page: 'contatos', module: 'Contatos', steps, coverage, screenFacts, appSha });
    const manifest = await captureScreens({ baseUrl, plan, appSha, fixture: true, root });
    assert.equal(manifest.entries.length, 2);
    assert.equal(manifest.entries[0].route, '/contact');
    assert.equal(manifest.entries[0].file, '/img/mcp/contatos/abrir.png');
    assert.ok(manifest.entries[0].masked.includes('varredura sensível'));
    assert.ok(manifest.entries[0].masked.includes('campo ou conteúdo dinâmico'));
    assert.deepEqual(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), manifest);
    const png = await readFile(join(root, 'contatos/abrir.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(png.length > 500);
    const browser = await launch();
    try {
      const inspect = await browser.newPage();
      const colors = await inspect.evaluate(async (url) => {
        const image = new Image(); image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const bytes = context.getImageData(0, 0, image.width, image.height).data;
        let mask = 0, frame = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          if (bytes[i] === 17 && bytes[i + 1] === 17 && bytes[i + 2] === 17) mask++;
          if (bytes[i] === 236 && bytes[i + 1] === 100 && bytes[i + 2] === 0) frame++;
        }
        return { mask, frame };
      }, `data:image/png;base64,${png.toString('base64')}`);
      assert.ok(colors.mask > 100, 'texto privado fica coberto no PNG');
      assert.ok(colors.frame > 100, 'elemento recebe moldura no PNG');
    } finally { await browser.close(); }
    assert.doesNotMatch(JSON.stringify(manifest), /cliente@exemplo/u);
    await assert.rejects(captureScreens({ baseUrl: 'https://ihelpchat.com.br', plan, appSha, root }), /host não permitido/u);
    const uploaded = join(root, 'upload.png');
    await writeFile(uploaded, png);
    await addUploadedScreenshot({ manifest, page: 'contatos', step: 'abrir', file: uploaded,
      alt: 'Tela de Contatos com o botão de adicionar', approved: true, appSha, root });
    assert.equal(chooseScreenshot(manifest, 'contatos', 'abrir').source, 'upload');
    assert.equal(screenshotForStep(manifest, 'contatos', 'abrir').source, 'upload');
    assert.equal(screenshotForStep(manifest, 'contatos', 'abrir', 'b'.repeat(40)), null);
    const article = attachScreenshotsToArticle({ path: 'docs/contatos', body: '1. Clique em Adicionar contato.\n2. Clique em Salvar contato.' }, manifest);
    assert.match(article.body, /!\[Tela de Contatos com o botão de adicionar\]\(\/img\/mcp\/contatos\/abrir\.png\)/u);
    assert.match(article.body, /!\[Tela de Contatos: Salvar contato\]\(\/img\/mcp\/contatos\/salvar\.png\)/u);
  } finally {
    await new Promise((ok) => server.close(ok));
    await rm(root, { recursive: true, force: true });
  }
});

test('plano exige rota e fato da tela com dono', () => {
  assert.throws(() => capturePlan({ page: 'contatos', module: 'Contatos', appSha, coverage, screenFacts: [], steps }), /fato da tela/u);
  assert.throws(() => capturePlan({ page: 'contatos', module: 'Contatos', appSha, coverage, screenFacts,
    steps: [{ ...steps[0], route: '/production' }] }), /coverage matrix/u);
});
