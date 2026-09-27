import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const review = await import('./security-review.mjs').catch(() => ({}));
import { submitContentPackage } from './content-service.mjs';

const article = { path: 'api/teste/contato', title: 'Consultar contato',
  description: 'Consulte os dados de um contato pelo identificador informado.',
  source: 'api', contentType: 'referencia', method: 'GET', endpoint: '/contacts/{id}',
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
    assert.match(result.questions.join(' '), /confirmo documentar: DELETE \/contacts\/\{id\}/iu);
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
    if (init.method === 'GET') return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => ({}) };
  };
  try {
    const result = await submitContentPackage(root, [{ ...article, method: 'DELETE' }], 'pull_request', 'user:tester', [],
      { confirmation: 'confirmo documentar: DELETE /contacts/{id}' });
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
