import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePage } from '../../mcp/screen-capture-service.mjs';
import { attachScreenshotsToArticle, screenshotReviewBody, screenshotVersionWarnings } from '../../mcp/screen-capture-manifest.mjs';

const oldSha = 'a'.repeat(40);
const currentSha = 'b'.repeat(40);
const fact = (text, route, owner, sha = currentSha) => ({ kind: 'action', text, route, owner, sha });
const article = { path: 'docs/contatos', body: '1. Clique em **Abrir**.' };

test('print capturado só entra no artigo com SHA dos fatos atuais; PR pede recaptura da versão antiga', async () => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<button>Abrir</button>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'screen-r4-'));
  try {
    const faqRoot = join(root, 'faq');
    await mkdir(join(faqRoot, 'docs'), { recursive: true });
    await writeFile(join(faqRoot, 'docs/contatos.mdx'), article.body);
    const options = { baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true, root,
      faqRoot, coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }] };
    const old = await capturePage({ path: 'docs/contatos', module: 'Contatos' }, {
      ...options, getScreenFacts: async () => [fact('Abrir', '/contact', 'contatos.tsx', oldSha)],
    });
    assert.equal(old.entries[0].checkoutSha, oldSha);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), old);
    const currentFacts = [fact('Abrir', '/contact', 'contatos.tsx')];
    const withoutImage = attachScreenshotsToArticle(article, old, currentSha, currentFacts);
    assert.doesNotMatch(withoutImage.body, /!\[/u);
    const pending = screenshotVersionWarnings([withoutImage], old, currentSha);
    assert.match(screenshotReviewBody('Pacote criado pelo MCP.', pending),
      /## Prints a revisar\n\n- print de versão anterior: recapturar contatos\/01-abrir/u);
    const renewed = await capturePage({ path: 'docs/contatos', module: 'Contatos' }, {
      ...options, getScreenFacts: async () => currentFacts,
    });
    assert.equal(renewed.entries[0].checkoutSha, currentSha);
    const withImage = attachScreenshotsToArticle(article, renewed, currentSha, currentFacts);
    assert.match(withImage.body, /!\[Tela de Contatos: Abrir\]\(\/img\/mcp\/contatos\/01-abrir\.png\)/u);
    assert.deepEqual(screenshotVersionWarnings([withImage], renewed, currentSha), []);
    assert.equal(screenshotReviewBody('Pacote criado pelo MCP.', []), 'Pacote criado pelo MCP.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

for (const [module, path, route] of [
  ['Contatos', 'docs/contatos', '/contact'], ['Robôs', 'docs/robos', '/robots'],
]) test(`${module}: lê a ordem da página aprovada e recusa tasks do chamador`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'screen-order-r4-'));
  try {
    const faqRoot = join(root, 'faq');
    await mkdir(join(faqRoot, 'docs'), { recursive: true });
    await writeFile(join(faqRoot, `${path}.mdx`), '1. Clique em **Abrir**.\n2. Clique em **Salvar**.');
    const options = { baseUrl: 'http://127.0.0.1:1', fixture: true, root, faqRoot,
      coverage: [{ module, productRoutes: [route] }],
      getScreenFacts: async () => [fact('Salvar', route, `${module}.tsx`), fact('Abrir', route, `${module}.tsx`)],
    };
    await assert.rejects(capturePage({ path, module, tasks: ['Salvar'] }, options), /entrada não permitida|tasks/u);
    const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<button>Abrir</button><button>Salvar</button>'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const manifest = await capturePage({ path, module }, { ...options,
        baseUrl: `http://127.0.0.1:${server.address().port}` });
      assert.deepEqual(manifest.entries.map((entry) => entry.label), ['Abrir', 'Salvar']);
      assert.deepEqual(manifest.entries.map((entry) => entry.step), ['01-abrir', '02-salvar']);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
