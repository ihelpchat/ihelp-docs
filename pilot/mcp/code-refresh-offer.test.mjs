import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { buildServer } from './server.mjs';
import { authorizeTool } from './access-control.mjs';
import { syncProductCheckouts } from './product-checkouts.mjs';
import { planContent, generateContentPackage } from './content-ai-service.mjs';
import { createGuide } from './create-guide.mjs';
const { refreshCodeProduct, withCodeRefreshOffer } = await import('./code-refresh-offer.mjs').catch(() => ({}));

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const root = await mkdtemp(join(tmpdir(), 'm554-'));
const stateDir = join(root, 'state');
const docsRoot = new URL('../', import.meta.url).pathname;
const previous = { front: process.env.PRODUCT_LOCAL_CHECKOUT, back: process.env.BACKEND_LOCAL_CHECKOUT,
  state: process.env.MCP_STATE_DIR, token: process.env.GITHUB_READ_TOKEN };
try {
  assert.equal(typeof refreshCodeProduct, 'function', 'ferramenta de refresh precisa existir');
  const repositories = {};
  for (const [id, role, ref, file] of [
    ['front', 'frontend', 'master', 'src/pages/Widget.tsx'],
    ['back', 'backend', 'release/validation', 'Controllers/PublicController.cs'],
  ]) {
    const bare = join(root, `${id}.git`);
    const work = join(root, `${id}-source`);
    await mkdir(work);
    git(root, 'init', '--bare', bare);
    git(work, 'init'); git(work, 'checkout', '-b', ref);
    await mkdir(join(work, file.split('/').slice(0, -1).join('/')), { recursive: true });
    await writeFile(join(work, file), id === 'front' ? 'export const widget = "produto widget";' : 'public class PublicController { public string Canal = "canal"; }');
    git(work, 'add', '.'); git(work, 'commit', '-m', 'fixture');
    git(work, 'remote', 'add', 'origin', bare); git(work, 'push', 'origin', ref);
    repositories[id] = { url: bare, ref, role, work, file };
  }
  const first = await syncProductCheckouts({ stateDir, token: 'fixture-token', repositories,
    now: () => new Date('2026-09-26T12:00:00Z') });
  process.env.MCP_STATE_DIR = stateDir;
  process.env.GITHUB_READ_TOKEN = 'fixture-token';
  process.env.PRODUCT_LOCAL_CHECKOUT = join(stateDir, 'checkouts/current/front');
  process.env.BACKEND_LOCAL_CHECKOUT = join(stateDir, 'checkouts/current/back');

  await test('endpoint API ausente oferece refresh com data e SHAs nos três caminhos', async () => {
    const request = { topic: 'Endpoint novo', module: 'api', description: 'Documentar GET /api/v1/nao-existe' };
    for (const run of [
      () => planContent(docsRoot, request, { contextOptions: { cache: false } }),
      () => generateContentPackage(docsRoot, request, { contextOptions: { cache: false } }),
      () => createGuide(docsRoot, { ...request, guideId: 'usuario-acesso', requestedBy: 'user:editor' }),
    ]) {
      const result = await run();
      assert.match(result.questions.at(-1), /Não encontrei isso no código da versão de 26\/09\/2026\. Quer atualizar a cópia do código e tentar de novo\? Use a ferramenta atualizar_codigo_produto\./u);
      assert.deepEqual(result.codeSnapshot, { front: first.front, back: first.back,
        updatedAt: first.updatedAt, stale: false });
    }
  });

  await test('código encontrado e pendência editorial não oferecem refresh', async () => {
    const context = { groundingRequired: true, code: [{ available: true, repository: 'front', ref: first.front.sha }],
      matches: [{ repository: 'front', path: 'src/pages/Widget.tsx', line: 1, sha: first.front.sha,
        excerpt: 'export const widget = "produto widget";' }], support: { categories: [], rules: [] }, coverage: [], pending: [] };
    const client = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
      status: 'needs_information', summary: 'Falta público alvo', questions: ['Qual público alvo?'], risks: [], suggestedActions: [],
    }) }) } };
    const result = await planContent(docsRoot, { topic: 'widget', module: 'produto', description: 'Documentar widget' },
      { productContext: context, client });
    assert.equal(result.codeSnapshot, undefined);
    assert.deepEqual(result.questions, ['Qual público alvo?']);
    const editorial = await withCodeRefreshOffer({ status: 'needs_information', pending: ['endpoint não público: confirmar'], questions: ['Confirme a publicação'] });
    assert.equal(editorial.codeSnapshot, undefined);
    assert.deepEqual(editorial.questions, ['Confirme a publicação']);
    const missingMatch = await planContent(docsRoot, { topic: 'widget', module: 'produto', description: 'Documentar widget' },
      { productContext: { ...context, matches: [] } });
    assert.match(missingMatch.questions.at(-1), /atualizar_codigo_produto/u);
  });

  await test('reader negado; writer atualiza SHA, recebe janela e concorrência protegida', async () => {
    const registered = new Map();
    const original = McpServer.prototype.registerTool;
    McpServer.prototype.registerTool = function (name, config, callback) { registered.set(name, config); return original.call(this, name, config, callback); };
    try { buildServer(docsRoot); } finally { McpServer.prototype.registerTool = original; }
    assert.equal(registered.get('atualizar_codigo_produto')?.mutates, true);
    assert.throws(() => authorizeTool({ actor: 'user:reader-554', role: 'reader' }, 'atualizar_codigo_produto', {}), /forbidden: reader cannot write/u);
    assert.equal(authorizeTool({ actor: 'user:writer-554', role: 'writer' }, 'atualizar_codigo_produto', {}), 'user:writer-554');
    const noToken = await refreshCodeProduct({ stateDir, token: '', repositories });
    assert.equal(noToken.reason, 'GITHUB_READ_TOKEN ausente');
    await writeFile(join(repositories.back.work, repositories.back.file), 'public class PublicController { public string Novo = "novo"; }');
    git(repositories.back.work, 'add', '.'); git(repositories.back.work, 'commit', '-m', 'new endpoint');
    git(repositories.back.work, 'push', 'origin', repositories.back.ref);
    const options = { stateDir, token: 'fixture-token', repositories, now: () => new Date('2026-09-26T12:01:00Z') };
    const updated = await refreshCodeProduct(options);
    assert.equal(updated.status, 'atualizado');
    assert.equal(updated.front.sha, first.front.sha);
    assert.notEqual(updated.back.sha, first.back.sha);
    const waiting = await refreshCodeProduct({ ...options, now: () => new Date('2026-09-26T12:02:00Z') });
    assert.match(waiting.reason, /aguarde 9 minutos/u);
    const unchanged = await refreshCodeProduct({ ...options, now: () => new Date('2026-09-26T12:12:00Z') });
    assert.equal(unchanged.status, 'sem mudança');
    let release;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const held = refreshCodeProduct({ ...options, now: () => new Date('2026-09-26T12:23:00Z'),
      sync: async () => { entered(); await new Promise((resolve) => { release = resolve; }); return updated; } });
    await started;
    const concurrent = await refreshCodeProduct({ ...options, now: () => new Date('2026-09-26T12:23:00Z') });
    assert.equal(concurrent.reason, 'atualização em andamento');
    release(); await held;
  });
} finally {
  for (const [key, env] of [['front', 'PRODUCT_LOCAL_CHECKOUT'], ['back', 'BACKEND_LOCAL_CHECKOUT'], ['state', 'MCP_STATE_DIR'], ['token', 'GITHUB_READ_TOKEN']]) {
    if (previous[key] === undefined) delete process.env[env]; else process.env[env] = previous[key];
  }
  await rm(root, { recursive: true, force: true });
}
