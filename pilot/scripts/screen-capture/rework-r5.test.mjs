import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePlan, captureScreens, masksCoverSensitive } from './capture.mjs';
import { uploadPage, downloadPage } from '../../mcp/screen-capture-service.mjs';
import * as screenService from '../../mcp/screen-capture-service.mjs';
import { attachScreenshotsToArticle, screenshotForStep, screenshotVersionWarnings } from '../../mcp/screen-capture-manifest.mjs';
import { launch } from '../visual/measure.mjs';

const sha = 'a'.repeat(40);

test('verificação exige cobertura integral antes de salvar', () => {
  assert.equal(masksCoverSensitive([{ x: 10, y: 10, width: 20, height: 10 }],
    [{ x: 10, y: 10, width: 19, height: 10 }]), false);
  assert.equal(masksCoverSensitive([{ x: 10, y: 10, width: 20, height: 10 }],
    [{ x: 9, y: 9, width: 22, height: 12 }]), true);
  assert.deepEqual(screenshotVersionWarnings([{ path: 'docs/contatos', body: 'Passo sem imagem.' }],
    { version: 1, entries: [], pending: ['print descartado: dado sensível sem máscara em /contact'] }, sha),
  ['print descartado: dado sensível sem máscara em /contact']);
});

test('Contatos e Robôs usam todos os rótulos dos passos reais, sem bullets de exemplo', async () => {
  const contatos = await readFile(new URL('../../content/docs/docs/sobre-o-sistema/agenda-de-contatos.mdx', import.meta.url), 'utf8');
  const robos = await readFile(new URL('../../content/docs/docs/sobre-o-sistema/robo-de-atendimento.mdx', import.meta.url), 'utf8');
  const facts = (labels, route) => labels.map((text) => ({ kind: 'action', text, route, owner: 'fixture', sha }));
  const c = capturePlan({ page: 'agenda-de-contatos', module: 'Contatos', faqBody: contatos,
    coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }], screenFacts: facts(['Filtro por letra', 'Claudinei', 'Adicionar Contato', 'Contatos', 'Importar Contatos'], '/contact') });
  assert.ok(c.some((step) => step.label === 'Adicionar Contato'));
  assert.ok(!c.some((step) => ['Filtro por letra', 'Claudinei'].includes(step.label)));
  const r = capturePlan({ page: 'robo-de-atendimento', module: 'Robôs', faqBody: robos,
    coverage: [{ module: 'Robôs', productRoutes: ['/bot'] }], screenFacts: facts(['Robôs', 'Criar novo Robô', 'Adicionar bloco'], '/bot') });
  assert.ok(r.some((step) => step.label === 'Criar novo Robô'));
  assert.ok(r.some((step) => step.label === 'Adicionar bloco'));
  assert.ok(r.findIndex((step) => step.label === 'Criar novo Robô') > r.findIndex((step) => step.label === 'Robôs'));
});

test('texto direto com filho e value de input ficam opacos no PNG', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<style>body{font:20px monospace}div,input{position:absolute;left:20px;width:400px;height:40px}div{top:70px}input{top:140px}input + input{top:190px}button{position:absolute;top:260px}</style><div>cliente@exemplo.com<span>Abrir</span></div><input value="outra@exemplo.com"><input placeholder="terceira@exemplo.com"><button>Abrir</button>');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r5-'));
  try {
    const manifest = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true, root,
      plan: [{ page: 'contatos', step: 'abrir', role: 'button', label: 'Abrir', route: '/', action: 'none', alt: 'Abrir', owner: 'fixture', checkoutSha: sha }] });
    assert.ok(manifest.entries[0].masked.includes('varredura sensível'));
    const png = await readFile(join(root, 'contatos', manifest.entries[0].file.split('/').at(-1)));
    const browser = await launch();
    try {
      const page = await browser.newPage();
      const pixels = await page.evaluate(async (data) => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
        return [[55, 85], [55, 155], [55, 205]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3));
      }, `data:image/png;base64,${png.toString('base64')}`);
      assert.deepEqual(pixels, [[226, 232, 240], [226, 232, 240], [226, 232, 240]]);
    } finally { await browser.close(); }
  } finally { await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true }); }
});

test('upload pendente não entra no artigo, e só token admin distinto aprova', async () => {
  const root = await mkdtemp(join(tmpdir(), 'screen-upload-r5-'));
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
  const env = { SCREEN_CAPTURE_ADMIN_TOKEN: 'admin-token-de-teste-com-mais-de-24', DOCS_MCP_API_KEY: 'mcp-token-de-teste-com-mais-de-24' };
  try {
    const manifest = await uploadPage({ page: 'contatos', step: 'abrir', base64: png.toString('base64'), alt: 'Tela de Contatos', approved: true }, { root });
    assert.equal(screenshotForStep(manifest, 'contatos', 'abrir'), null);
    assert.equal((await downloadPage('contatos', { root })).images.length, 0);
    assert.doesNotMatch(attachScreenshotsToArticle({ path: 'docs/contatos', body: 'Clique em Abrir.' }, manifest).body, /!\[/u);
    assert.match(screenshotVersionWarnings([{ path: 'docs/contatos', body: 'Clique em Abrir.' }], manifest, sha).join(' '), /print enviado aguardando revisão: contatos\/abrir/u);
    await assert.rejects(screenService.approvePage({ page: 'contatos', step: 'abrir', token: env.DOCS_MCP_API_KEY, approvedBy: 'revisor' }, { root, env }), /admin/u);
    const approved = await screenService.approvePage({ page: 'contatos', step: 'abrir', token: env.SCREEN_CAPTURE_ADMIN_TOKEN, approvedBy: 'revisor' }, { root, env });
    assert.equal(approved.entries[0].approvedBy, 'revisor');
    assert.ok(approved.entries[0].approvedAt);
    assert.equal((await downloadPage('contatos', { root })).images.length, 1);
    await assert.rejects(uploadPage({ page: 'contatos', step: 'outro', base64: Buffer.from('texto').toString('base64'), alt: 'Outro' }, { root }), /PNG|JPEG/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
