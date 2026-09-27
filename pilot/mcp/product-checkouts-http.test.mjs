import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIhelpContext } from './product-context-service.mjs';
import { planContent } from './content-ai-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'm553-http-'));
const contentSha = 'a'.repeat(64);
const codeSha = 'b'.repeat(40);
await mkdir(join(root, 'public/guides', contentSha.slice(0, 12)), { recursive: true });
await mkdir(join(root, 'content/docs'), { recursive: true });
await writeFile(join(root, 'public/guides/manifest.json'), JSON.stringify({ current: contentSha.slice(0, 12) }));
await writeFile(join(root, 'public/guides', contentSha.slice(0, 12), 'catalog.json'), JSON.stringify({ contentSha256: contentSha }));
await writeFile(join(root, 'public/release.json'), JSON.stringify({ codeSha }));

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function health(extra = {}) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const child = spawn(process.execPath, [new URL('./http.mjs', import.meta.url).pathname], {
    env: { ...process.env, GITHUB_READ_TOKEN: '', PRODUCT_LOCAL_CHECKOUT: '', BACKEND_LOCAL_CHECKOUT: '',
      PORT: String(port), DOCS_ROOT: root, OPENAI_API_KEY: '',
      DOCS_MCP_API_KEY: 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz', ...extra },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        return { status: response.status, body: await response.json() };
      } catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
    }
    assert.fail(`servidor não iniciou: ${stderr}`);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
}

try {
  await test('sem token /health informa motivo sem 503', async () => {
    const result = await health();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.productContext, { status: 'unavailable', reason: 'GITHUB_READ_TOKEN ausente' });
  });
  await test('checkouts autorizados mostram os SHAs no /health', async () => {
    const paths = {};
    const shas = {};
    for (const id of ['front', 'back']) {
      paths[id] = join(root, id);
      await mkdir(paths[id]);
      git(paths[id], 'init');
      await writeFile(join(paths[id], 'README'), id);
      git(paths[id], 'add', '.');
      git(paths[id], 'commit', '-m', 'fixture');
      shas[id] = git(paths[id], 'rev-parse', 'HEAD');
    }
    const result = await health({ PRODUCT_LOCAL_CHECKOUT: paths.front, BACKEND_LOCAL_CHECKOUT: paths.back });
    assert.equal(result.status, 200);
    assert.equal(result.body.productContext.front.sha, shas.front);
    assert.equal(result.body.productContext.back.sha, shas.back);
  });
  await test('boot HTTP sincroniza os dois repositórios e planContent usa ambos', async () => {
    const rewrite = [];
    for (const [id, ref, file, word] of [
      ['front', 'master', 'src/pages/Widget.tsx', 'widget'],
      ['back', 'release/validation', 'Controllers/ChannelController.cs', 'canal'],
    ]) {
      const bare = join(root, `${id}-boot.git`);
      const work = join(root, `${id}-boot-source`);
      await mkdir(work);
      git(root, 'init', '--bare', bare);
      git(work, 'init'); git(work, 'checkout', '-b', ref);
      await mkdir(join(work, file.split('/').slice(0, -1).join('/')), { recursive: true });
      await writeFile(join(work, file), `export const ${word} = '${word} fixture';`);
      git(work, 'add', '.'); git(work, 'commit', '-m', 'fixture');
      git(work, 'remote', 'add', 'origin', bare); git(work, 'push', 'origin', ref);
      const remote = id === 'front' ? 'front-react' : 'olah-ihelp';
      rewrite.push(`[url "file://${bare}"]\n\tinsteadOf = https://github.com/ihelpchat/${remote}.git`);
    }
    const config = join(root, 'gitconfig');
    await writeFile(config, `${rewrite.join('\n')}\n`);
    const stateDir = join(root, 'boot-state');
    const result = await health({ MCP_STATE_DIR: stateDir, GITHUB_READ_TOKEN: 'fixture-token', GIT_CONFIG_GLOBAL: config });
    assert.equal(result.status, 200);
    const restarted = await health({ MCP_STATE_DIR: stateDir });
    assert.equal(restarted.status, 200);
    assert.equal(restarted.body.productContext.front.sha, result.body.productContext.front.sha);
    assert.equal(restarted.body.productContext.back.sha, result.body.productContext.back.sha);
    assert.equal(restarted.body.productContext.stale, true);
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import './pilot/mcp/http.mjs';
      import { planContent } from './pilot/mcp/content-ai-service.mjs';
      import { getIhelpContext } from './pilot/mcp/product-context-service.mjs';
      const root = process.cwd() + '/pilot/';
      const context = await getIhelpContext(root, 'widget', 'produto', { requireLocal: true, cache: false });
      const match = context.matches.find((item) => item.path === 'src/pages/Widget.tsx');
      const plan = await planContent(root,
        { topic: 'widget', module: 'produto', description: 'Documentar widget' },
        { contextOptions: { cache: false }, client: { responses: { create: async () => ({
          model: 'fixture', output_text: JSON.stringify({ status: 'ready', guidance: 'Abra a tela.', questions: [],
            risks: [], suggestedActions: [], grounding: match ? [{ text: 'Abra a tela.', citations: [{
              repository: match.repository, path: match.path, lineStart: match.line, lineEnd: match.line,
              sha: match.sha }] }] : [] }) }) } } });
      process.stdout.write(JSON.stringify({ status: plan.status, files: plan.productContext?.files ?? [] }));
      process.exit(0);
    `], { cwd: new URL('../..', import.meta.url).pathname, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, MCP_STATE_DIR: stateDir, GITHUB_READ_TOKEN: '', PRODUCT_LOCAL_CHECKOUT: '',
        BACKEND_LOCAL_CHECKOUT: '', PORT: '0', DOCS_ROOT: root, OPENAI_API_KEY: '',
        DOCS_MCP_API_KEY: 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz' } });
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(JSON.parse(probe.stdout).status, 'ready');
    assert.ok(JSON.parse(probe.stdout).files.some((file) => file.includes('src/pages/Widget.tsx')),
      'planContent precisa ler a geração restaurada sem token');
    const previous = { front: process.env.PRODUCT_LOCAL_CHECKOUT, back: process.env.BACKEND_LOCAL_CHECKOUT };
    process.env.PRODUCT_LOCAL_CHECKOUT = join(stateDir, 'checkouts/current/front');
    process.env.BACKEND_LOCAL_CHECKOUT = join(stateDir, 'checkouts/current/back');
    try {
      for (const [topic, expected] of [['widget', 'src/pages/Widget.tsx'], ['canal', 'Controllers/ChannelController.cs']]) {
        const context = await getIhelpContext(new URL('../', import.meta.url).pathname, topic, 'produto', { requireLocal: true, cache: false });
        const match = context.matches.find((item) => item.path === expected);
        assert.ok(match, `contexto ausente: ${expected}`);
        const client = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
          status: 'ready', guidance: 'Abra a tela.', questions: [], risks: [], suggestedActions: [],
          grounding: [{ text: 'Abra a tela.', citations: [{ repository: match.repository, path: match.path,
            lineStart: match.line, lineEnd: match.line, sha: match.sha }] }],
        }) }) } };
        const plan = await planContent(new URL('../', import.meta.url).pathname,
          { topic, module: 'produto', description: `Documentar ${topic}` }, { client, contextOptions: { cache: false } });
        assert.equal(plan.status, 'ready');
        assert.ok(plan.productContext.files.some((file) => file.includes(expected)));
      }
    } finally {
      if (previous.front === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
      else process.env.PRODUCT_LOCAL_CHECKOUT = previous.front;
      if (previous.back === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
      else process.env.BACKEND_LOCAL_CHECKOUT = previous.back;
    }
  });
} finally { await rm(root, { recursive: true, force: true }); }
