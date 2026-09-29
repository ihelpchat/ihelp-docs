import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addUploadedScreenshot, capturePlan, captureScreens, chooseScreenshot } from './capture.mjs';
import { launch } from '../visual/measure.mjs';
import { attachScreenshotsToArticle, screenshotForStep } from '../../mcp/screen-capture-manifest.mjs';
import { assertAllowedTarget } from '../guide-proof.mjs';
import { approvePage, capturePage, downloadPage, imagesUsedByArticles } from '../../mcp/screen-capture-service.mjs';

const appSha = 'a'.repeat(40);
const coverage = [{ module: 'Contatos', productRoutes: ['/contact'] }];
const screenFacts = [
  { kind: 'action', text: 'Abrir contato', owner: 'fixture', sha: appSha },
  { kind: 'action', text: 'Salvar contato', owner: 'fixture', sha: appSha },
];
const getScreenFacts = async () => screenFacts;

test('fixture local: rota, clique, destaque, máscara e manifesto', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><body><button id="open">Abrir contato</button>
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
    const plan = capturePlan({ page: 'contatos', module: 'Contatos', faqBody: '1. **Abrir contato**\n2. **Salvar contato**', coverage, screenFacts });
    let manifest = await captureScreens({ baseUrl, plan, fixture: true, root });
    assert.equal(manifest.entries.length, 2);
    assert.equal(manifest.entries[0].route, '/contact');
    assert.match(manifest.entries[0].file, new RegExp(`^/img/mcp/contatos/${plan[0].step}\\.automatic\\.[a-f0-9]{64}\\.png$`, 'u'));
    assert.match(manifest.entries[0].bundleSha, /^[a-f0-9]{40}$/u);
    assert.equal(manifest.entries[0].checkoutSha, appSha);
    assert.notEqual(manifest.entries[0].bundleSha, appSha, 'versão do bundle vem da página');
    assert.ok(manifest.entries[0].masked.includes('varredura sensível'));
    assert.ok(manifest.entries[0].masked.includes('campo ou conteúdo dinâmico'));
    assert.deepEqual(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), manifest);
    const png = await readFile(join(root, 'contatos', manifest.entries[0].file.split('/').at(-1)));
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
          if (bytes[i] === 226 && bytes[i + 1] === 232 && bytes[i + 2] === 240) mask++;
          if (bytes[i] === 236 && bytes[i + 1] === 100 && bytes[i + 2] === 0) frame++;
        }
        return { mask, frame };
      }, `data:image/png;base64,${png.toString('base64')}`);
      assert.ok(colors.mask > 100, 'texto privado fica coberto no PNG');
      assert.ok(colors.frame > 100, 'elemento recebe moldura no PNG');
    } finally { await browser.close(); }
    assert.doesNotMatch(JSON.stringify(manifest), /cliente@exemplo/u);
    await assert.rejects(captureScreens({ baseUrl: 'https://ihelpchat.com.br', plan, root }), /host não permitido/u);
    const uploaded = join(root, 'upload.png');
    await writeFile(uploaded, png);
    await addUploadedScreenshot({ manifest, page: 'contatos', step: plan[0].step, file: uploaded,
      alt: 'Tela de Contatos com o botão de abrir', root });
    assert.equal(chooseScreenshot(manifest, 'contatos', plan[0].step).source, 'automatic');
    assert.equal(screenshotForStep(manifest, 'contatos', plan[0].step).source, 'automatic');
    manifest = await approvePage({ page: 'contatos', step: plan[0].step, token: 'admin-token-de-teste-com-mais-de-24', approvedBy: 'revisor' },
      { root, env: { SCREEN_CAPTURE_ADMIN_TOKEN: 'admin-token-de-teste-com-mais-de-24' } });
    assert.equal(screenshotForStep(manifest, 'contatos', plan[0].step).source, 'upload');
    const article = attachScreenshotsToArticle({ path: 'docs/contatos', body: '1. Clique em Abrir contato.\n2. Clique em Salvar contato.' }, manifest, appSha);
    assert.match(article.body, /!\[Tela de Contatos com o botão de abrir\]/u);
    assert.match(article.body, /!\[Tela de Contatos: Salvar contato\]/u);
  } finally {
    await new Promise((ok) => server.close(ok));
    await rm(root, { recursive: true, force: true });
  }
});

test('plano exige rota e fato da tela com dono', () => {
  assert.throws(() => capturePlan({ page: 'contatos', module: 'Contatos', faqBody: '1. **Abrir contato**', coverage, screenFacts: [] }), /fato da tela/u);
  assert.throws(() => capturePlan({ page: 'contatos', module: 'Contatos', faqBody: '1. **Abrir contato**', coverage,
    screenFacts: [{ ...screenFacts[0], route: '/production' }] }), /fato da tela/u);
});

test('plano preserva a rota de cada fato em módulos com mais de uma tela', () => {
  const plan = capturePlan({ page: 'contatos', module: 'Contatos', faqBody: '1. **Abrir contato**\n2. **Salvar contato**',
    coverage: [{ module: 'Contatos', productRoutes: ['/contact', '/contact/import'] }],
    screenFacts: [{ ...screenFacts[0], route: '/contact' },
      { ...screenFacts[1], route: '/contact/import' }] });
  assert.deepEqual(plan.map((step) => step.route), ['/contact', '/contact/import']);
});

test('host exato aprovado aceita homologação Railway e rejeita produção conhecida', () => {
  const host = 'example-qa.up.railway.app';
  assert.equal(assertAllowedTarget(`https://${host}/`, { GUIDE_QA_ALLOWED_HOSTS: host }).url, `https://${host}`);
  assert.throws(() => assertAllowedTarget(`https://${host}/`, {}), /host não permitido/u);
  assert.throws(() => assertAllowedTarget('https://app.ihelpchat.com/', { GUIDE_QA_ALLOWED_HOSTS: 'app.ihelpchat.com' }), /host não permitido/u);
});

test('serviço MCP captura fixture, baixa imagens e limita volume sem vazar segredo', async () => {
  const secret = 'senha-super-secreta-da-fixture';
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<button>Abrir contato</button><p>cliente@exemplo.com</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const root = await mkdtemp(join(tmpdir(), 'screen-service-'));
  try {
    const faqRoot = join(root, 'faq');
    await mkdir(join(faqRoot, 'docs'), { recursive: true });
    await writeFile(join(faqRoot, 'docs/contatos.mdx'), '1. Clique em **Abrir contato**.');
    await writeFile(join(faqRoot, 'docs/robos.mdx'), '1. Clique em **Abrir contato**.');
    const result = await capturePage({ path: 'docs/contatos', module: 'Contatos' }, {
      baseUrl: `http://127.0.0.1:${server.address().port}`, root, fixture: true,
      faqRoot, coverage, getScreenFacts, env: { GUIDE_QA_AUTHORIZED_PASSWORD: secret },
    });
    assert.equal(result.entries.length, 1);
    const second = await capturePage({ path: 'docs/robos', module: 'Robôs' }, {
      baseUrl: `http://127.0.0.1:${server.address().port}`, root, fixture: true,
      faqRoot, coverage: [{ module: 'Robôs', productRoutes: ['/contact'] }], getScreenFacts,
    });
    assert.equal(second.entries.length, 2, 'capturar outra página preserva o manifesto anterior');
    const read = await downloadPage('contatos', { root, limit: 1 });
    assert.equal(read.images.length, 1);
    assert.equal(Buffer.from(read.images[0].base64, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.doesNotMatch(JSON.stringify(read), /senha-super|cliente@exemplo/u);
    const selected = await imagesUsedByArticles([
      { path: 'docs/contatos', body: `![Tela de Contatos](${read.entries[0].file})` },
      { path: 'docs/robos', body: 'Sem print nesta página.' },
    ], { root });
    assert.deepEqual(selected.map((image) => image.file), [`pilot/public${read.entries[0].file}`]);
    assert.equal(selected[0].base64, read.images[0].base64);
    await assert.rejects(downloadPage('contatos', { root, limit: 5 }), /Consulta de telas inválida/u);
    await assert.rejects(downloadPage('../contatos', { root }), /Consulta de telas inválida/u);
    await writeFile(join(root, 'contatos', read.entries[0].file.split('/').at(-1)), Buffer.concat([
      Buffer.from(read.images[0].base64, 'base64'), Buffer.alloc(2 * 1024 * 1024),
    ]));
    await assert.rejects(downloadPage('contatos', { root }), /Integridade da imagem divergente/u);
  } finally {
    await new Promise((ok) => server.close(ok));
    await rm(root, { recursive: true, force: true });
  }
});
