import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePage } from '../../mcp/screen-capture-service.mjs';
import * as screenshots from '../../mcp/screen-capture-manifest.mjs';
import { capturePlan } from './capture.mjs';
import { assertAllowedTarget } from '../guide-proof.mjs';

const checkoutSha = 'a'.repeat(40);
const facts = (route, owner) => [
  { kind: 'action', text: 'Salvar', route, owner, sha: checkoutSha },
  { kind: 'action', text: 'Abrir', route, owner, sha: checkoutSha },
];

for (const [module, page, route] of [
  ['Contatos', 'contatos', '/contact'], ['Robôs', 'robos', '/robots'],
]) test(`${module}: captura segue a ordem dos passos aprovados, não a dos fatos`, () => {
  const plan = capturePlan({ page, module, tasks: ['Abrir', 'Salvar'],
    coverage: [{ module, productRoutes: [route] }], screenFacts: facts(route, `${page}.tsx`) });
  assert.deepEqual(plan.map((step) => step.label), ['Abrir', 'Salvar']);
  assert.deepEqual(plan.map((step) => step.step), ['01-abrir', '02-salvar']);
  assert.equal(plan[0].owner, `${page}.tsx`);
});

test('captura automática entra no passo da FAQ apesar de bundle e checkout divergirem', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<button>Abrir</button>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'screen-r3-'));
  try {
    const manifest = await capturePage({ page: 'contatos', module: 'Contatos', tasks: ['Abrir'] }, {
      baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true, root,
      coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }],
      getScreenFacts: async () => facts('/contact', 'contatos.tsx'),
    });
    const [entry] = manifest.entries;
    assert.equal(entry.route, '/contact');
    assert.equal(entry.owner, 'contatos.tsx');
    assert.equal(entry.checkoutSha, checkoutSha);
    assert.match(entry.bundleSha, /^[a-f0-9]{40}$/u);
    assert.notEqual(entry.bundleSha, entry.checkoutSha);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), manifest);
    const article = screenshots.attachScreenshotsToArticle({ path: 'docs/contatos', body: '1. Clique em **Abrir**.' }, manifest, checkoutSha);
    assert.match(article.body, /!\[Tela de Contatos: Abrir\]\(\/img\/mcp\/contatos\/01-abrir\.png\)/u);
    const mismatched = { ...manifest, entries: [{ ...entry, owner: 'outra-tela.tsx' }] };
    const factsForArticle = facts('/contact', 'contatos.tsx');
    assert.doesNotMatch(screenshots.attachScreenshotsToArticle({ path: 'docs/contatos', body: '1. Clique em **Abrir**.' },
      mismatched, checkoutSha, factsForArticle).body, /!\[/u);
    assert.equal(typeof screenshots.screenshotVersionWarnings, 'function');
    assert.match(screenshots.screenshotVersionWarnings([article], manifest).join(' '), /bundle.*checkout.*diverg/iu);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('staging.ihelpchat.com sem entrada exata na allowlist é recusado', () => {
  assert.throws(() => assertAllowedTarget('https://staging.ihelpchat.com', {
    GUIDE_QA_ALLOWED_HOSTS: 'homolog.ihelpchat.com',
  }), /host não permitido/u);
});
