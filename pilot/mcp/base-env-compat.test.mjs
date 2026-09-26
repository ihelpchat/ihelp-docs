import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// Snapshot from `git grep -ohE 'process\.env\.[A-Z][A-Z0-9_]+' 1f9e5d3 --
// 'pilot/mcp/*.mjs' ':!pilot/mcp/*.test.mjs' | sort -u`.
const baseSha = '1f9e5d3';
const baseNames = new Set('ASSISTANT_ALLOWED_ORIGINS ASSISTANT_IP_LIMIT BACKEND_GITHUB_REF BACKEND_GITHUB_REPOSITORY DOCS_MCP_API_KEY DOCS_ROOT FEEDBACK_ADMIN_TOKEN FEEDBACK_FILE GITHUB_BASE_BRANCH GITHUB_REPOSITORY GITHUB_TOKEN LOG_ID_KEY MOCK_GITHUB_OUTCOME OPENAI_API_KEY OPENAI_MODEL PORT PRODUCT_GITHUB_REF PRODUCT_GITHUB_REPOSITORY RAILWAY_ENVIRONMENT_NAME SESSION_EVENTS_FILE TRUSTED_IP_SOURCE TRUST_PROXY_HOPS'.split(' '));
assert.ok(baseNames.has('DOCS_MCP_API_KEY') && baseNames.has('GITHUB_TOKEN'), `base ${baseSha} must include legacy names`);
assert.ok(!baseNames.has('DOCS_MCP_CREDENTIALS') && !baseNames.has('GITHUB_READ_TOKEN'));

const sourceDir = new URL('./', import.meta.url);
for (const file of await readdir(sourceDir)) {
  if (!file.endsWith('.mjs') || file.endsWith('.test.mjs') || file === 'test.mjs' || file === 'env-compat.mjs') continue;
  const source = await readFile(new URL(file, sourceDir), 'utf8');
  assert.doesNotMatch(source, /process\.env\.(?:DOCS_MCP_API_KEY|DOCS_MCP_CREDENTIALS|GITHUB_TOKEN|GITHUB_READ_TOKEN)\b/, `${file} must use the single compatibility table`);
}

const saved = new Map(['DOCS_MCP_API_KEY', 'DOCS_MCP_CREDENTIALS', 'GITHUB_TOKEN', 'GITHUB_READ_TOKEN', 'MCP_STATE_DIR', 'DOCS_ROOT', 'PORT'].map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const root = await mkdtemp(join(tmpdir(), 'm514-base-env-'));
await mkdir(join(root, 'architecture'));
await mkdir(join(root, 'content/docs'), { recursive: true });
for (const file of ['support-signals.json', 'coverage-matrix.json']) {
  await copyFile(new URL(`../architecture/${file}`, import.meta.url), join(root, 'architecture', file));
}
const key = 'legacy-base-env-abcdefghijklmnopqrstuvwxyz';
const token = 'legacy-github-fixture';
for (const name of ['DOCS_MCP_CREDENTIALS', 'GITHUB_READ_TOKEN', 'MCP_STATE_DIR']) delete process.env[name];
process.env.DOCS_MCP_API_KEY = key;
process.env.GITHUB_TOKEN = token;
process.env.DOCS_ROOT = root;
process.env.PORT = '0';
const requested = [];
globalThis.fetch = async (url, options = {}) => {
  const value = String(url);
  if (!value.startsWith('https://api.github.com/')) return originalFetch(url, options);
  requested.push({ value, authorization: options.headers?.Authorization });
  assert.equal(options.headers?.Authorization, `Bearer ${token}`);
  if (value.includes('/git/trees/')) {
    return { ok: true, json: async () => ({ tree: [{ type: 'blob', path: 'src/Contacts/index.tsx' }] }) };
  }
  if (value.includes('/contents/')) {
    return { ok: true, json: async () => ({ encoding: 'base64', content: Buffer.from('export const title = "Importar contatos";').toString('base64') }) };
  }
  assert.fail(`unexpected GitHub request: ${value}`);
};
let httpServer;
let client;
try {
  ({ httpServer } = await import('./http.mjs'));
  if (!httpServer.listening) await once(httpServer, 'listening');
  const url = new URL(`http://127.0.0.1:${httpServer.address().port}/mcp`);
  client = new Client({ name: 'base-env-compat', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: { token: async () => key } }));
  const result = await client.callTool({ name: 'docs_product_context', arguments: { topic: 'Importar contatos', module: 'Contatos' } });
  assert.equal(result.isError, false);
  const context = JSON.parse(result.content[0].text);
  assert.equal(context.code.length, 2);
  assert.ok(context.code.every((source) => source.available === true && source.matches.length > 0), 'both private repositories must remain available with base-only env');
  assert.equal(requested.filter(({ value }) => value.includes('/git/trees/')).length, 2);
  const deleteResult = await client.callTool({ name: 'docs_delete_article', arguments: { path: 'docs/teste/ausente', mode: 'draft' } });
  assert.equal(deleteResult.isError, false, 'legacy actor can still use write tools');
} finally {
  await client?.close();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  globalThis.fetch = originalFetch;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
