import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

async function scenario(providerStatus, withKey = true, { spent = 0, retry = false, providerMessage } = {}) {
  let calls = 0;
  let currentStatus = providerStatus;
  const provider = createServer(async (request, response) => {
    calls++;
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const payload = JSON.parse(raw);
    assert.equal(payload.model, 'fixture-router');
    assert.equal(payload.reasoning.effort, 'low');
    assert.equal(payload.text.format.schema.properties.choice.enum.length, 5, 'catálogo mínimo de 2 guias e 3 escolhas');
    response.writeHead(currentStatus, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(currentStatus !== 200
      ? { error: { message: providerMessage ?? (currentStatus === 400 ? "Unsupported value: 'low'" : 'Provider unavailable'), type: 'invalid_request_error' } }
      : { id: 'resp_fixture', object: 'response', created_at: 1, model: 'fixture-router', status: 'completed',
        output: [{ type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: '{"choice":"perguntar"}', annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const port = await freePort();
  const ledgerFile = join(root, `ledger-${providerStatus}-${withKey}-${spent}-${retry}.json`);
  await writeFile(ledgerFile, JSON.stringify({ day: new Date().toISOString().slice(0, 10), spent, reservations: {} }));
  const child = spawn(process.execPath, [new URL('./http.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), DOCS_ROOT: root, DOCS_MCP_API_KEY: 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz',
      OPENAI_API_KEY: withKey ? 'fixture-openai-key' : '', OPENAI_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
      ASSISTANT_ROUTER_MODEL: 'fixture-router', ASSISTANT_ROUTER_EFFORT: 'low',
      ASSISTANT_BUDGET_FILE: ledgerFile, ASSISTANT_DAILY_LIMIT_USD: '1',
      ASSISTANT_INPUT_USD_PER_MILLION: '10', ASSISTANT_OUTPUT_USD_PER_MILLION: '10' },
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
    let final = first;
    if (retry) {
      currentStatus = 200;
      await new Promise((resolve) => setTimeout(resolve, 30_100));
      const afterRetry = await fetch(`http://127.0.0.1:${port}/health`);
      final = { status: afterRetry.status, body: await afterRetry.json() };
      assert.equal(calls, 2, '500 deve permitir nova tentativa após 30 s');
    }
    return { first, final, calls, ledger: JSON.parse(await readFile(ledgerFile, 'utf8')), stderr };
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
  await test('provider 400 torna /health 503 com código fixo', async () => {
    const { first: result } = await scenario(400);
    assert.equal(result.status, 503);
    assert.equal(result.body.error, 'triagem rejeitada pelo provider');
    assert.equal(result.body.reason, 'unsupported_parameter');
  });
  await test('mensagem do provider com segredo não sai no /health', async () => {
    const result = await scenario(400, true, { providerMessage: 'Unsupported value: sk-TESTSECRET-EXAMPLE' });
    assert.equal(result.first.status, 503);
    assert.equal(result.first.body.reason, 'unsupported_parameter');
    assert.doesNotMatch(JSON.stringify(result.first.body), /sk-|TESTSECRET/u);
    assert.doesNotMatch(result.stderr, /sk-TESTSECRET-EXAMPLE/u, 'log também deve redigir o segredo');
  });
  await test('401 usa código auth_failed', async () => {
    const { first } = await scenario(401);
    assert.equal(first.status, 503);
    assert.equal(first.body.reason, 'auth_failed');
  });
  await test('mensagem desconhecida usa provider_rejected', async () => {
    const { first } = await scenario(400, true, { providerMessage: 'Mensagem desconhecida' });
    assert.equal(first.status, 503);
    assert.equal(first.body.reason, 'provider_rejected');
  });
  await test('provider aceita triagem e /health responde 200', async () => {
    const { first: result } = await scenario(200);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.codeSha, codeSha);
  });
  await test('sem OPENAI_API_KEY self-check é pulado', async () => {
    const { first: result } = await scenario(400, false);
    assert.equal(result.status, 200);
  });
  await test('spent perto do teto não impede self-check e custo real é contabilizado', async () => {
    const result = await scenario(200, true, { spent: 999_990 });
    assert.equal(result.first.status, 200, JSON.stringify(result.first.body));
    assert.equal(result.ledger.spent, 1_000_010, 'usage de 1 token por direção custa 20 unidades');
  });
  await test('provider 500 não fica em cache; nova tentativa aceita dá 200', async () => {
    const result = await scenario(500, true, { retry: true });
    assert.equal(result.first.status, 503);
    assert.equal(result.first.body.reason, 'provider_rejected');
    assert.equal(result.final.status, 200, JSON.stringify(result.final.body));
  });
  await test('orçamento esgotado é estado de uso no /health 200', async () => {
    const result = await scenario(200, true, { spent: 1_000_000 });
    assert.equal(result.first.status, 200, JSON.stringify(result.first.body));
    assert.equal(result.first.body.budget, 'exhausted');
  });
} finally { await rm(root, { recursive: true, force: true }); }
