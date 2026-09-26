import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'm548-health-'));
const sha = 'a'.repeat(64);
const codeSha = 'b'.repeat(40);
await mkdir(join(root, 'public/guides', sha.slice(0, 12)), { recursive: true });
await mkdir(join(root, 'content/docs'), { recursive: true });
await writeFile(join(root, 'public/guides/manifest.json'), JSON.stringify({ current: sha.slice(0, 12) }));
await writeFile(join(root, 'public/guides', sha.slice(0, 12), 'catalog.json'), JSON.stringify({ contentSha256: sha }));
await writeFile(join(root, 'public/release.json'), JSON.stringify({ codeSha }));

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function scenario(providerStatus, withKey = true) {
  let calls = 0;
  const provider = createServer(async (request, response) => {
    calls++;
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const payload = JSON.parse(raw);
    assert.equal(payload.model, 'fixture-router');
    assert.equal(payload.reasoning.effort, 'low');
    assert.equal(payload.text.format.schema.properties.choice.enum.length, 5, 'catálogo mínimo de 2 guias e 3 escolhas');
    response.writeHead(providerStatus, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(providerStatus === 400
      ? { error: { message: "Unsupported value: 'low'", type: 'invalid_request_error' } }
      : { id: 'resp_fixture', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"choice":"perguntar"}' }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const port = await freePort();
  const child = spawn(process.execPath, [new URL('./http.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), DOCS_ROOT: root, DOCS_MCP_API_KEY: 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz',
      OPENAI_API_KEY: withKey ? 'fixture-openai-key' : '', OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
      ASSISTANT_ROUTER_MODEL: 'fixture-router', ASSISTANT_ROUTER_EFFORT: 'low',
      ASSISTANT_BUDGET_FILE: join(root, `ledger-${providerStatus}-${withKey}.json`) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { response = await fetch(`http://127.0.0.1:${port}/health`); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
    }
    assert.ok(response, `servidor não iniciou: ${stderr}`);
    const first = { status: response.status, body: await response.json() };
    const second = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(second.status, first.status, 'self-check em cache');
    assert.equal(calls, withKey ? 1 : 0, 'uma chamada por processo; sem chave pula');
    return first;
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await new Promise((resolve) => provider.close(resolve));
  }
}

try {
  await test('provider 400 torna /health 503 com motivo', async () => {
    const result = await scenario(400);
    assert.equal(result.status, 503);
    assert.equal(result.body.error, 'triagem rejeitada pelo provider');
    assert.match(result.body.reason, /Unsupported value: 'low'/u);
  });
  await test('provider aceita triagem e /health responde 200', async () => {
    const result = await scenario(200);
    assert.equal(result.status, 200);
    assert.equal(result.body.codeSha, codeSha);
  });
  await test('sem OPENAI_API_KEY self-check é pulado', async () => {
    const result = await scenario(400, false);
    assert.equal(result.status, 200);
  });
} finally { await rm(root, { recursive: true, force: true }); }
