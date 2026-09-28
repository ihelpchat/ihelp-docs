import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvePage, capturePage, uploadPage } from '../../mcp/screen-capture-service.mjs';
import { capturePlan, captureScreens } from './capture.mjs';
import { attachScreenshotsToArticle, loadScreenshotManifest } from '../../mcp/screen-capture-manifest.mjs';

const sha = 'a'.repeat(40);
const coverage = [{ module: 'Contatos', productRoutes: ['/contact'] }];

test('plano do chamador não atravessa a fronteira do serviço', async () => {
  await assert.rejects(capturePage({ path: 'docs/contatos', module: 'Contatos', appSha: sha,
    steps: [{ id: 'excluir', role: 'button', label: 'Excluir contato', action: 'click' }],
    screenFacts: [{ kind: 'action', text: 'Excluir contato', owner: 'fixture-inventada', sha }] },
  { baseUrl: 'http://127.0.0.1:1', fixture: true, coverage }), /plano do chamador|entrada não permitida/iu);
});

test('mesmo plano interno com Excluir é fotografado sem clique', async () => {
  let clicks = 0;
  const server = createServer((req, res) => {
    if (req.url === '/clicked') { clicks++; res.end('ok'); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<button onclick="fetch(\'/clicked\')">Excluir contato</button>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'screen-r2-'));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const manifest = await captureScreens({ baseUrl, fixture: true, root, appSha: sha,
      plan: [{ page: 'contatos', step: 'excluir', role: 'button', label: 'Excluir contato',
        route: '/contact', action: 'click', alt: 'Botão Excluir contato', appSha: sha }] });
    assert.equal(manifest.entries.length, 1);
    assert.equal(clicks, 0);
    assert.equal((await readFile(join(root, 'contatos/excluir.png'))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('upload revisado e captura compartilham manifesto do gerador; upload prevalece', async () => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<button>Excluir contato</button>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const state = await mkdtemp(join(tmpdir(), 'screen-state-r2-'));
  const root = join(state, 'screens');
  const previous = process.env.MCP_STATE_DIR;
  process.env.MCP_STATE_DIR = state;
  try {
    const facts = [{ kind: 'action', text: 'Excluir contato', owner: 'src/Contacts.tsx', sha }];
    const faqRoot = join(state, 'faq');
    await mkdir(join(faqRoot, 'docs'), { recursive: true });
    await writeFile(join(faqRoot, 'docs/contatos.mdx'), '1. Clique em **Excluir contato**.');
    const [step] = capturePlan({ page: 'contatos', module: 'Contatos', faqBody: '1. **Excluir contato**', coverage, screenFacts: facts });
    const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
    await uploadPage({ page: 'contatos', step: step.step, base64: png.toString('base64'),
      alt: 'Botão Excluir contato revisado' });
    await capturePage({ path: 'docs/contatos', module: 'Contatos' }, {
      baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true,
      faqRoot, coverage, getScreenFacts: async () => facts,
    });
    let manifest = await loadScreenshotManifest();
    assert.equal(manifest.entries.length, 1);
    assert.equal(manifest.entries[0].source, 'upload');
    assert.equal(manifest.entries[0].label, 'Excluir contato');
    assert.equal(manifest.entries[0].status, 'pending');
    assert.doesNotMatch(attachScreenshotsToArticle({ path: 'docs/contatos', body: 'Clique em Excluir contato.' }, manifest).body, /!\[/u);
    manifest = await approvePage({ page: 'contatos', step: step.step, token: 'admin-token-de-teste-com-mais-de-24', approvedBy: 'revisor' },
      { root, env: { SCREEN_CAPTURE_ADMIN_TOKEN: 'admin-token-de-teste-com-mais-de-24' } });
    assert.deepEqual(await readFile(join(root, 'contatos', `${step.step}.png`)), png);
    const article = attachScreenshotsToArticle({ path: 'docs/contatos', body: 'Clique em Excluir contato.' }, manifest);
    assert.match(article.body, /!\[Botão Excluir contato revisado\]/u);
  } finally {
    if (previous === undefined) delete process.env.MCP_STATE_DIR;
    else process.env.MCP_STATE_DIR = previous;
    await new Promise((resolve) => server.close(resolve));
    await rm(state, { recursive: true, force: true });
  }
});
