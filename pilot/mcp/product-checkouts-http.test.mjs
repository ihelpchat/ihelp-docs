import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
} finally { await rm(root, { recursive: true, force: true }); }
