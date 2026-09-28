import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { addUploadedScreenshot, captureScreens } from '../scripts/screen-capture/capture.mjs';
import { attachScreenshotsToArticle } from './screen-capture-manifest.mjs';
import { approvePage, captureFailureCategory } from './screen-capture-service.mjs';
import { syncProductCheckouts } from './product-checkouts.mjs';
import { syncBusinessContext } from './business-context-sync.mjs';
import { validateRailwayDockerContext } from './railway-docker-context.mjs';

const sha = 'a'.repeat(40);
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');

test('upload pendente conserva automático até aprovação, inclusive após recaptura', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capture-r8-'));
  const server = createServer((_request, response) => response.end('<button>Abrir</button>'));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const page = 'contatos'; const step = '01-abrir';
    const automatic = { page, step, label: 'Abrir', route: '/', owner: 'fixture', listIndex: 0, line: 0,
      file: `/img/mcp/${page}/${step}.png`, alt: 'Tela automática', checkoutSha: sha,
      bundleSha: sha, source: 'automatic', masked: [] };
    const manifest = { version: 1, entries: [automatic] };
    await addUploadedScreenshot({ manifest, page, step, bytes: png, alt: 'Tela enviada', root });
    assert.equal(manifest.entries.length, 2);
    await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true, root, manifest,
      plan: [{ page, step, label: 'Abrir', route: '/', role: 'button', action: 'none', alt: 'Tela automática nova',
        checkoutSha: sha, owner: 'fixture', listIndex: 0, line: 0 }] });
    assert.equal(manifest.entries.filter((entry) => entry.page === page && entry.step === step).length, 2);
    assert.equal(manifest.entries.find((entry) => entry.source === 'automatic')?.alt, 'Tela automática nova');
    assert.equal(attachScreenshotsToArticle({ path: 'docs/contatos', body: '1. Abrir' }, manifest, sha).body.includes('![Tela automática nova]'), true);
    // A nova captura precisa continuar elegível mesmo com um upload pendente.
    const { chooseScreenshot } = await import('../scripts/screen-capture/capture.mjs');
    assert.equal(chooseScreenshot(manifest, page, step)?.source, 'automatic');
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    const approved = await approvePage({ page, step, token: 'synthetic-admin-token-1234567890', approvedBy: 'user:fixture' },
      { root, env: { SCREEN_CAPTURE_ADMIN_TOKEN: 'synthetic-admin-token-1234567890' } });
    assert.equal(attachScreenshotsToArticle({ path: 'docs/contatos', body: '1. Abrir' }, approved, sha).body.includes('![Tela enviada]'), true);
  } finally {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});

test('Railway aceita todas as origens COPY e recusa VOLUME; mutações quebram a barreira', async () => {
  const docker = await readFile(new URL('../Dockerfile.mcp', import.meta.url), 'utf8');
  const ignore = await readFile(new URL('../.railwayignore', import.meta.url), 'utf8');
  assert.deepEqual(validateRailwayDockerContext(docker, ignore), []);
  assert.match(validateRailwayDockerContext(docker, `${ignore}\nlib\n`).join(' '), /lib/u);
  assert.match(validateRailwayDockerContext(`${docker}\nVOLUME \/data\n`, ignore).join(' '), /VOLUME/u);
});

test('falhas de sync registram etapa e primeira linha sem token nem URL com credencial', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-r8-'));
  const token = 'synthetic-secret-token-123';
  try {
    const logs = [];
    await assert.rejects(syncProductCheckouts({ stateDir: root, token, log: (line) => logs.push(line),
      repositories: { front: { url: `https://user:${token}@invalid.invalid/front.git`, ref: 'main', role: 'frontend' } } }));
    assert.match(logs.join('\n'), /front.*clone/u);
    assert.doesNotMatch(logs.join('\n'), /synthetic-secret|user:|AUTHORIZATION|https:\/\//iu);
    const businessLogs = [];
    await assert.rejects(syncBusinessContext({ stateDir: root, sourceDir: join(root, 'missing'),
      log: (line) => businessLogs.push(line) }));
    assert.match(businessLogs.join('\n'), /contexto.*(ler|copiar|readdir)/iu);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('capturar_telas informa apenas a categoria segura do motivo', () => {
  assert.equal(captureFailureCategory(new Error('Fatos da tela indisponíveis: https://user:secret@host')), 'fatos da tela indisponíveis');
  assert.equal(captureFailureCategory(new Error('Destino recusado: https://user:secret@host')), 'host de QA não permitido');
  assert.equal(captureFailureCategory(new Error('Login na homologação falhou: pessoa@example.test')), 'login na homologação falhou');
  assert.equal(captureFailureCategory(new Error('Nenhum fato da tela confirmado nos passos')), 'nenhum passo com rótulo da tela');
  assert.equal(captureFailureCategory(new Error('Plano excede 20 passos')), 'limite de passos');
  assert.equal(captureFailureCategory(new Error('token secreto')), 'captura indisponível');
});
