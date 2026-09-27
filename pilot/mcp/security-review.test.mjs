import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const review = await import('./security-review.mjs').catch(() => ({}));
import { submitContentPackage } from './content-service.mjs';
import { renderApiReference } from './api-reference-render.mjs';
import { McpServer } from '@modelcontextprotocol/server';
import { buildServer } from './server.mjs';

const article = { path: 'api/teste/contato', title: 'Consultar contato',
  description: 'Consulte os dados de um contato pelo identificador informado.',
  source: 'api', contentType: 'referencia', method: 'GET', endpoint: '/contacts',
  body: '## Exemplo\n\n```http\nGET https://apiv3.ihelpchat.com/api/v2/contacts/id-exemplo-1\n```\n\nExemplo fictício.' };
const facts = { parameters: [{ name: 'id', in: 'route', type: 'string' }] };
const examine = (candidate = article, input = {}) => {
  assert.equal(typeof review.securityReview, 'function');
  return review.securityReview(candidate, { facts: input.facts ?? facts, request: input });
};

test('positivo seguro e negativos de uma alteração explicam bloqueio', () => {
  assert.deepEqual(examine(), { blocks: [], warnings: [] });
  for (const [name, changed, reason] of [
    ['telefone', article.body.replace('id-exemplo-1', '5511998765432'), /telefone|dado pessoal/iu],
    ['ObjectId', article.body.replace('id-exemplo-1', '507f1f77bcf86cd799439011'), /id|ObjectId/iu],
    ['host interno', article.body.replace('apiv3.ihelpchat.com', 'intranet.example.test'), /host|URL/iu],
    ['role', `${article.body}\n\nRequer role: SuperAdmin.`, /role|autorização/iu],
  ]) {
    assert.match(examine({ ...article, body: changed }).blocks.join(' '), reason, name);
  }
  assert.match(examine(article, { facts: { parameters: [{ name: 'id', in: 'route', serverAssigned: true }] } }).blocks.join(' '), /id|serverAssigned|servidor/iu);
});

test('DELETE sem confirmação retorna needs_information e não escreve no GitHub', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm556-'));
  await mkdir(join(root, 'content/docs'), { recursive: true });
  const writes = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (...args) => { writes.push(args); throw Error('GitHub não pode ser chamado'); };
  try {
    const destructive = { ...article, method: 'DELETE' };
    const result = await submitContentPackage(root, [destructive], 'pull_request', 'user:tester');
    assert.equal(result.status, 'needs_information');
    assert.match(result.securityWarnings.join(' '), /DELETE/iu);
    assert.match(result.questions.join(' '), /confirmo documentar: DELETE \/contacts/iu);
    assert.equal(writes.length, 0);
  } finally { globalThis.fetch = before; }
});

test('DELETE confirmado segue e PR contém Atenção de segurança', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm556-'));
  await mkdir(join(root, 'content/docs'), { recursive: true });
  const calls = [];
  const before = globalThis.fetch;
  const oldToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fixture-token';
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const path = new URL(url).pathname;
    if (path.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: 'fixture-sha' } }) };
    if (path.endsWith('/pulls') && init.method === 'POST') return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/123' }) };
    if ((init.method ?? 'GET') === 'GET') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  };
  try {
    const result = await submitContentPackage(root, [{ ...article, method: 'DELETE' }], 'pull_request', 'user:tester', [],
      { confirmation: 'confirmo documentar: DELETE /contacts' });
    assert.equal(result.status, 'pull_request');
    assert.match(result.securityWarnings.join(' '), /DELETE/iu);
    const pull = calls.find(({ url, init }) => url.endsWith('/pulls') && init.method === 'POST');
    assert.match(JSON.parse(pull.init.body).body, /Atenção de segurança/iu);
  } finally { globalThis.fetch = before; if (oldToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldToken; }
});

test('auditoria encontra exemplo de contato existente', async () => {
  assert.equal(typeof review.auditApiPages, 'function');
  const findings = await review.auditApiPages(new URL('../', import.meta.url).pathname);
  assert.match(JSON.stringify(findings), /api\/contatos\/buscar-detalhes-do-contato/iu);
});

test('renderizador usa exemplos sintéticos tipados sem copiar baseUrl da página', () => {
  const rendered = renderApiReference({ verb: 'POST', route: '/api/v2/contacts/{id}', policy: 'authenticated',
    parameters: [{ name: 'id', in: 'route', type: 'string' }, { name: 'phone', in: 'body', type: 'string' },
      { name: 'count', in: 'body', type: 'int' }, { name: 'active', in: 'body', type: 'bool' }], responseFields: [] },
  [{ baseUrl: 'https://intranet.example.test', sections: ['Exemplo'], languages: ['bash'] }]);
  assert.match(rendered.body, /https:\/\/apiv3\.ihelpchat\.com\/api\/v2\/contacts\/id-exemplo-1/u);
  assert.match(rendered.body, /"phone":"5500000000000"/u);
  assert.match(rendered.body, /"count":1/u);
  assert.match(rendered.body, /"active":false/u);
  assert.deepEqual(examine({ ...article, body: rendered.body }).blocks, []);
});

test('normalização e artigo inteiro bloqueiam variantes de dados sensíveis', () => {
  assert.deepEqual(examine(), { blocks: [], warnings: [] });
  for (const [name, candidate, reason] of [
    ['ObjectId separado', { ...article, body: article.body.replace('id-exemplo-1', '507F1F77-BCF8-6CD7-9943-9011') }, /id real|ObjectId/iu],
    ['telefone com máscara', { ...article, body: article.body.replace('id-exemplo-1', '(11) 99876-5432') }, /telefone|dado pessoal/iu],
    ['endpoint interno', { ...article, endpoint: 'http://10.0.0.5/internal' }, /host|URL/iu],
    ['campo futuro', { ...article, foo: { nested: ['http://10.0.0.5/internal'] } }, /host|URL/iu],
  ]) assert.match(examine(candidate).blocks.join(' '), reason, name);
});

test('GET com showAll no corpo avisa mesmo quando também menciona limit', () => {
  const candidate = { ...article, body: `${article.body}\n\nGET /contacts?showAll=true&limit=50` };
  assert.deepEqual(examine().warnings, []);
  assert.match(examine(candidate).warnings.join(' '), /todos os dados|showAll|volume/iu);
});

test('ferramentas mutates herdam confirmation e DELETE confirmado segue via docs_submit_article', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm556-tool-'));
  await mkdir(join(root, 'content/docs'), { recursive: true });
  const registered = new Map();
  const original = McpServer.prototype.registerTool;
  McpServer.prototype.registerTool = function (name, config, callback) {
    registered.set(name, { config, callback });
    return original.call(this, name, config, callback);
  };
  try { buildServer(root); }
  finally { McpServer.prototype.registerTool = original; }
  for (const [name, { config }] of registered) if (config.mutates)
    assert.equal(config.inputSchema.shape.confirmation?.safeParse('confirmo documentar: DELETE /contacts').success, true,
      `${name} aceita confirmation`);
  const tool = registered.get('docs_submit_article').callback;
  const priorFetch = globalThis.fetch;
  const priorToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fixture-token';
  let writes = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method && init.method !== 'GET') writes++;
    const path = new URL(url).pathname;
    if (path.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: 'fixture-sha' } }) };
    if (path.endsWith('/pulls') && init.method === 'POST') return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/123' }) };
    if ((init.method ?? 'GET') === 'GET') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  };
  try {
    const result = await tool({ ...article, method: 'DELETE', mode: 'pull_request', requestedBy: 'user:tester', confirmation: 'confirmo documentar: DELETE /contacts' });
    assert.equal(JSON.parse(result.content[0].text).status, 'pull_request');
    assert.ok(writes > 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = priorToken;
  }
});

test('docs_submit_package bloqueia API parametrizada sem fatos, sem factsByPath', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm556-facts-'));
  await mkdir(join(root, 'content/docs'), { recursive: true });
  const prior = process.env.BACKEND_LOCAL_CHECKOUT;
  process.env.BACKEND_LOCAL_CHECKOUT = join(root, 'checkout-indisponivel');
  const registered = new Map();
  const original = McpServer.prototype.registerTool;
  McpServer.prototype.registerTool = function (name, config, callback) {
    registered.set(name, callback); return original.call(this, name, config, callback);
  };
  try {
    buildServer(root);
    const result = await registered.get('docs_submit_package')({ articles: [{ ...article, endpoint: '/contacts/{id}' }], deletes: [], mode: 'dry_run', requestedBy: 'user:tester' });
    assert.match(JSON.stringify(result.content), /fatos do código indisponíveis para a revisão de segurança/iu);
  } finally {
    McpServer.prototype.registerTool = original;
    if (prior === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT; else process.env.BACKEND_LOCAL_CHECKOUT = prior;
  }
});
