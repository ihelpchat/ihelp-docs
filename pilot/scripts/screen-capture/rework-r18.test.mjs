import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureScreens, chooseScreenshot } from './capture.mjs';
import { attachScreenshotsToArticle } from '../../mcp/screen-capture-manifest.mjs';

const sha = 'a'.repeat(40);
const step = (extra = {}) => ({ page: 'fixture', step: '01-importar-contatos', label: 'Importar contatos',
  role: 'button', route: '/contact', action: 'none', alt: 'Tela de Contatos: Importar contatos',
  owner: 'ContactsList', checkoutSha: sha, line: 0, listIndex: 0, ...extra });
const article = { path: 'docs/fixture', body: '1. Clique em **Importar contatos**.' };

async function fixture(run) {
  let html = '';
  const writes = [];
  const server = createServer((request, response) => {
    if (request.method !== 'GET') writes.push(request.method);
    if (request.url === '/write') { response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<title>Fixture</title>${html}`);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r18-'));
  try {
    return await run({ root, writes, setHtml: (value) => { html = value; },
      capture: (plan, manifest) => captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`,
        root, fixture: true, plan, manifest, vocabulary: ['Mais opções', 'Importar contatos', 'Exportar', 'Carregando'] }) });
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
}

test('sem fato que liga gatilho ao item, aria-haspopup e nome genérico não provocam escrita', { timeout: 90000 }, async () => {
  await fixture(async ({ setHtml, capture, writes }) => {
    setHtml(`<button aria-haspopup="true" onclick="fetch('/write', {method:'POST'})">Exportar</button>
      <button aria-label="Mais opções" onclick="fetch('/write', {method:'POST'})">⋮</button>`);
    const result = await capture([step()]);
    assert.equal(result.steps[0].status, 'pendente', JSON.stringify(result.steps));
    assert.deepEqual(writes, []);
  });
});

test('fato explícito autoriza só o gatilho nomeado; ação insegura continua bloqueada', { timeout: 90000 }, async () => {
  await fixture(async ({ setHtml, capture, writes }) => {
    setHtml(`<button aria-haspopup="true" onclick="fetch('/write', {method:'POST'})">Exportar</button>
      <button aria-label="Mais opções" onclick="document.querySelector('#menu').hidden=false">⋮</button>
      <div id="menu" role="menu" hidden><button role="menuitem" onclick="fetch('/write', {method:'POST'})">Importar contatos</button></div>`);
    const allowed = await capture([step({ menuTrigger: 'Mais opções', menuTriggerFact: {
      text: 'Mais opções', opensMenuFor: 'Importar contatos', route: '/contact', owner: 'ContactsList', sha } })]);
    assert.equal(allowed.steps[0].status, 'capturado', JSON.stringify(allowed.steps));
    assert.deepEqual(writes, []);
    setHtml(`<button aria-haspopup="true" onclick="fetch('/write', {method:'POST'})">Exportar</button>`);
    const unsafe = await capture([step({ menuTrigger: 'Exportar', menuTriggerFact: {
      text: 'Exportar', opensMenuFor: 'Importar contatos', route: '/contact', owner: 'ContactsList', sha } })]);
    assert.equal(unsafe.steps[0].status, 'pendente', JSON.stringify(unsafe.steps));
    assert.deepEqual(writes, []);
  });
});

test('loading persiste como pendência sem anexo; recaptura limpa libera o artigo', { timeout: 90000 }, async () => {
  await fixture(async ({ setHtml, capture }) => {
    setHtml('<button>Importar contatos</button><div class="skeleton">Carregando</div>');
    const first = await capture([step()]);
    assert.equal(first.steps[0].motivo, 'print com carregamento');
    assert.notEqual(first.steps[0].status, 'capturado');
    assert.equal(chooseScreenshot(first, 'fixture', '01-importar-contatos'), null);
    assert.equal(attachScreenshotsToArticle(article, first, sha).body, article.body);
    assert.ok(first.pending.includes('print com carregamento: 01-importar-contatos'));

    setHtml('<button>Importar contatos</button>');
    const second = await capture([step()], first);
    assert.equal(second.steps[0].status, 'capturado', JSON.stringify(second.steps));
    assert.match(attachScreenshotsToArticle(article, second, sha).body, /!\[Tela de Contatos: Importar contatos\]/u);
  });
});
