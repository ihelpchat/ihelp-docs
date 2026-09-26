import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { readArticle } from './editorial-standard.mjs';
import { buildServer } from './server.mjs';

const root = new URL('../', import.meta.url).pathname;
const article = await readArticle(root, 'api/crm/funis/listar-funis');
const request = {
  ...article,
  articles: [article],
  deletes: [],
  mode: 'pull_request',
  requestedBy: 'service:token-test',
  topic: 'Importar contatos',
  module: 'Contatos',
  details: 'Conferir o fluxo de importação de contatos no produto.',
  query: 'contatos',
  limit: 1,
};
const envNames = ['GITHUB_TOKEN', 'GITHUB_READ_TOKEN', 'OPENAI_API_KEY', 'MCP_STATE_DIR', 'PRODUCT_GITHUB_REF', 'BACKEND_GITHUB_REF'];
const savedEnv = new Map(envNames.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const originalRegisterTool = McpServer.prototype.registerTool;

async function exercise(label, readToken) {
  const writeToken = `fixture-write-${label}`;
  process.env.GITHUB_TOKEN = writeToken;
  if (readToken) process.env.GITHUB_READ_TOKEN = readToken;
  else delete process.env.GITHUB_READ_TOKEN;
  delete process.env.OPENAI_API_KEY;
  process.env.MCP_STATE_DIR = await mkdtemp(join(tmpdir(), 'm514-token-routing-'));
  process.env.PRODUCT_GITHUB_REF = `token-test-front-${label}`;
  process.env.BACKEND_GITHUB_REF = `token-test-back-${label}`;

  const tools = new Map();
  McpServer.prototype.registerTool = function (name, config, callback) {
    tools.set(name, { config, callback });
    return originalRegisterTool.call(this, name, config, callback);
  };
  try { buildServer(root); } finally { McpServer.prototype.registerTool = originalRegisterTool; }
  assert.ok(tools.size > 0, 'the tool registry must be exercised');

  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com', 'test must not call another external service');
    const method = init.method ?? 'GET';
    calls.push({ method, path: parsed.pathname, authorization: init.headers?.Authorization });
    if (parsed.pathname.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: 'fixture-sha' } }) };
    if (parsed.pathname.endsWith('/git/trees/token-test-front-' + label) || parsed.pathname.endsWith('/git/trees/token-test-back-' + label)) {
      return { ok: true, json: async () => ({ tree: [{ type: 'blob', path: 'src/Contacts/index.tsx' }] }) };
    }
    if (parsed.pathname.endsWith('/pulls')) return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/321' }) };
    if (parsed.pathname.endsWith('/git/refs')) return { ok: true, json: async () => ({}) };
    if (parsed.pathname.includes('/contents/')) {
      if (method !== 'GET') return { ok: true, json: async () => ({}) };
      const content = parsed.pathname.endsWith('/meta.json')
        ? '{"pages":["listar-funis"]}'
        : parsed.pathname.endsWith('.mdx') ? '# Artigo de teste' : 'export const title = "Importar contatos";';
      return { ok: true, json: async () => ({ sha: 'fixture-file-sha', encoding: 'base64', content: Buffer.from(content).toString('base64') }) };
    }
    assert.fail(`unexpected GitHub call: ${method} ${parsed.pathname}`);
  };

  const reached = new Map();
  for (const [name, { config, callback }] of tools) {
    const start = calls.length;
    const input = Object.fromEntries(Object.keys(config.inputSchema.shape).filter((key) => key in request).map((key) => [key, request[key]]));
    await callback(config.inputSchema.parse(input));
    reached.set(name, calls.slice(start));
  }
  const githubTools = [...reached].filter(([, requests]) => requests.length);
  assert.ok(githubTools.length >= 5, `GitHub-facing tools reached: ${githubTools.map(([name]) => name).join(', ')}`);
  assert.ok(!githubTools.some(([name]) => ['docs_plan_content', 'docs_generate_package'].includes(name)), 'AI editorial exige checkout local e não consulta código privado pelo GitHub');
  assert.ok(calls.some(({ method }) => method === 'GET'), 'private code reads must run');
  assert.ok(calls.some(({ method }) => method === 'POST'), 'branch and PR creation must run');
  assert.ok(calls.some(({ method }) => method === 'PUT'), 'commit writes must run');
  assert.ok(calls.some(({ method }) => method === 'DELETE'), 'article deletion must run');
  for (const [name, requests] of githubTools) {
    for (const { method, path, authorization } of requests) {
      const expected = method === 'GET' && !path.startsWith('/repos/ihelpchat/ihelp-docs/') ? (readToken ?? writeToken) : writeToken;
      assert.equal(authorization, `Bearer ${expected}`, `${label}: ${name} ${method} ${path}`);
    }
  }
  return { githubTools: githubTools.map(([name]) => name), calls: calls.length };
}

try {
  const split = await exercise('split', 'fixture-read-split');
  const legacy = await exercise('legacy');
  assert.deepEqual(split.githubTools, legacy.githubTools, 'legacy must exercise the same registered tools');
  console.log(`GitHub token routing: ${split.githubTools.length} tools, ${split.calls} split calls, ${legacy.calls} legacy calls`);
} finally {
  McpServer.prototype.registerTool = originalRegisterTool;
  globalThis.fetch = originalFetch;
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
