import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePage } from '../../mcp/screen-capture-service.mjs';
import { captureScreens } from './capture.mjs';

const sha = 'a'.repeat(40);
const coverage = [{ module: 'Contatos', productRoutes: ['/contact'] }];

test('plano do chamador não atravessa a fronteira do serviço', async () => {
  await assert.rejects(capturePage({ page: 'contatos', module: 'Contatos', appSha: sha,
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
