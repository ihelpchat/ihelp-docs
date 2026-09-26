import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const legacyKey = 'legacy-test-abcdefghijklmnopqrstuvwxyz-123456';
const writerKey = 'writer-test-abcdefghijklmnopqrstuvwxyz-123456';
const actor = 'service:migration-test';
const baseEnv = { ...process.env };
delete baseEnv.DOCS_MCP_API_KEY;
delete baseEnv.DOCS_MCP_CREDENTIALS;

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function start(extraEnv, shouldStart = true) {
  const port = await freePort();
  const stateDir = await mkdtemp(join(tmpdir(), 'm514-migration-'));
  const child = spawn(process.execPath, [new URL('./http.mjs', import.meta.url).pathname], {
    env: { ...baseEnv, PORT: String(port), MCP_STATE_DIR: stateDir, ...extraEnv },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(url);
      if (shouldStart) return { child, url, stateDir, stderr: () => stderr };
      child.kill('SIGINT');
      await once(child, 'exit');
      assert.fail('MCP started without credentials');
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (shouldStart) assert.fail(`MCP failed to start: ${stderr}`);
  assert.notEqual(child.exitCode, 0);
  return { child, url, stateDir, stderr: () => stderr };
}

async function connect(url, key) {
  const client = new Client({ name: 'migration-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: { token: async () => key } }));
  return client;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGINT');
  await once(child, 'exit');
}

const absent = await start({}, false);
assert.match(absent.stderr(), /DOCS_MCP_(?:CREDENTIALS|API_KEY)/);
assert.doesNotMatch(absent.stderr(), /MCP ouvindo/);

const legacy = await start({ DOCS_MCP_API_KEY: legacyKey });
try {
  const client = await connect(legacy.url, legacyKey);
  try {
    const read = await client.callTool({ name: 'docs_inventory', arguments: {} });
    assert.equal(read.isError, false);
    const write = await client.callTool({ name: 'docs_delete_article', arguments: { path: 'docs/teste/ausente', mode: 'draft' } });
    assert.equal(write.isError, false);
    assert.doesNotMatch(write.content[0].text, /forbidden|requestedBy/i);
  } finally { await client.close(); }
  assert.match(legacy.stderr(), /DOCS_MCP_API_KEY.*(?:deprecated|descontinuad)/i);
  assert.equal(legacy.stderr().includes(legacyKey), false);
} finally { await stop(legacy.child); }

const both = await start({
  DOCS_MCP_API_KEY: legacyKey,
  DOCS_MCP_CREDENTIALS: JSON.stringify([{ actor, role: 'writer', key: writerKey }]),
});
try {
  const rejected = await fetch(both.url, { headers: { Authorization: `Bearer ${legacyKey}` } });
  assert.equal(rejected.status, 401);
  const client = await connect(both.url, writerKey);
  try {
    const withoutActor = await client.callTool({ name: 'docs_delete_article', arguments: { path: 'docs/teste/ausente', mode: 'draft' } });
    assert.equal(withoutActor.isError, false);
    assert.doesNotMatch(withoutActor.content[0].text, /requestedBy/i);
    const forged = await client.callTool({ name: 'docs_delete_article', arguments: { path: 'docs/teste/ausente', requestedBy: 'user:other' } });
    assert.equal(forged.isError, true);
    assert.match(forged.content[0].text, /requestedBy forged/);
    assert.match(forged.content[0].text, /"status": 403/);
    const personal = await client.callTool({ name: 'docs_delete_article', arguments: { path: 'docs/teste/ausente', requestedBy: 'other@example.test' } });
    assert.match(personal.content[0].text, /requestedBy forged/);
  } finally { await client.close(); }
  const audit = await readFile(join(both.stateDir, '.audit', 'docs-submissions.jsonl'), 'utf8');
  assert.match(audit, /"actor":"service:migration-test".*"operation":"docs_delete_article".*"result":"forbidden"/);
  assert.doesNotMatch(audit, /user:other/);
  assert.doesNotMatch(audit, /other@example\.test/);
  assert.match(both.stderr(), /DOCS_MCP_API_KEY.*ignorad/i);
  assert.equal(both.stderr().includes(legacyKey), false);
} finally { await stop(both.child); }
