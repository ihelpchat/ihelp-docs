import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePlan, captureScreens } from './capture.mjs';
import { attachScreenshotsToArticle } from '../../mcp/screen-capture-manifest.mjs';
import { launch } from '../visual/measure.mjs';
import { screenshotFile } from '../../mcp/screenshot-files.mjs';

const sha = 'a'.repeat(40);

test('Robôs: cada ocorrência de Adicionar bloco tem plano, manifesto e anexo no próprio passo', async () => {
  const body = await readFile(new URL('../../content/docs/docs/sobre-o-sistema/robo-de-atendimento.mdx', import.meta.url), 'utf8');
  const fact = { kind: 'action', text: 'Adicionar bloco', route: '/bot', owner: 'fixture', sha };
  const plan = capturePlan({ page: 'robo-de-atendimento', module: 'Robôs', faqBody: body,
    coverage: [{ module: 'Robôs', productRoutes: ['/bot'] }], screenFacts: [fact] });
  assert.equal(plan.length, 4);
  assert.equal(new Set(plan.map((item) => item.step)).size, plan.length);
  assert.deepEqual(plan.map((item) => body.split('\n')[item.line].match(/^\d+/u)?.[0]), ['1', '3', '2', '4']);
  const manifest = { version: 1, entries: plan.map((item) => { const file = screenshotFile(item.page, item.step, 'automatic', Buffer.from('fixture'), 'png');
    return { ...item, source: 'automatic', masked: [], bundleSha: sha, file, sha256: file.split('.')[2] }; }) };
  const article = attachScreenshotsToArticle({ path: 'docs/robo-de-atendimento', body }, manifest, sha, [fact]);
  const lines = article.body.split('\n');
  for (const item of plan) {
    const numbered = lines.findIndex((line) => line === body.split('\n')[item.line]);
    assert.ok(numbered >= 0);
    assert.equal(lines[numbered + 2], `![${item.alt}](${manifest.entries.find((entry) => entry.step === item.step).file})`);
  }
});

test('alvo abaixo da dobra é rolado e moldura/seta aparecem dentro do PNG', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<style>body{margin:0;height:2400px}button{position:absolute;top:1800px;left:160px;width:160px;height:48px}</style><button>Abrir</button>');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r7-scroll-'));
  try {
    const manifest = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true, root,
      plan: [{ page: 'contatos', step: '01-abrir', role: 'button', label: 'Abrir', route: '/', action: 'none',
        alt: 'Abrir', owner: 'fixture', checkoutSha: sha }] });
    assert.equal(manifest.entries.length, 1);
    const png = await readFile(join(root, 'contatos', manifest.entries[0].file.split('/').at(-1)));
    const browser = await launch();
    try {
      const page = await browser.newPage();
      const proof = await page.evaluate(async (url) => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let frame = 0, arrow = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] !== 236 || pixels[index + 1] !== 100 || pixels[index + 2] !== 0) continue;
          const x = index / 4 % image.width;
          if (x < 155) arrow++;
          else if (x < 330) frame++;
        }
        return { width: image.width, height: image.height, frame, arrow };
      }, `data:image/png;base64,${png.toString('base64')}`);
      assert.deepEqual([proof.width, proof.height], [1280, 720]);
      assert.ok(proof.frame > 500, 'moldura deve aparecer dentro do PNG');
      assert.ok(proof.arrow > 10, 'seta deve aparecer dentro do PNG');
    } finally { await browser.close(); }
  } finally { await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true }); }
});
