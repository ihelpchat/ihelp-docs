import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate, authorizeTool, loadCredentials } from './access-control.mjs';
import { auditOperation, submitArticle } from './content-service.mjs';
import { searchProductContext } from './product-context-service.mjs';
import { buildServer } from './server.mjs';

buildServer(); // Exercita o mesmo registro de políticas usado pelo HTTP.

const readerKey = 'reader-abcdefghijklmnopqrstuvwxyz-123456';
const writerKey = 'writer-abcdefghijklmnopqrstuvwxyz-123456';
const credentials = loadCredentials(JSON.stringify([
  { actor: 'user:reader', role: 'reader', key: readerKey },
  { actor: 'user:writer', role: 'writer', key: writerKey },
]));
const reader = authenticate(credentials, `Bearer ${readerKey}`);
const writer = authenticate(credentials, `Bearer ${writerKey}`);
assert.equal(reader.actor, 'user:reader');
assert.equal(writer.actor, 'user:writer');
assert.equal(authenticate(credentials, 'Bearer revoked-abcdefghijklmnopqrstuvwxyz-123456'), null, 'removed key is revoked');
assert.equal(authenticate(loadCredentials(JSON.stringify([{ actor: 'user:reader', role: 'reader', key: readerKey }])), `Bearer ${writerKey}`), null, 'removing writer from configuration revokes it after restart');
assert.equal(authorizeTool(reader, 'docs_search', {}), 'user:reader');
assert.throws(() => authorizeTool(reader, 'docs_submit_article', {}), /forbidden/i);
assert.throws(() => authorizeTool(writer, 'docs_product_context', {}), /forbidden/i, 'writer cannot read private product code');
assert.throws(() => authorizeTool(writer, 'docs_submit_article', { requestedBy: 'user:reader' }), /requestedBy/i, 'body cannot forge actor');
assert.equal(authorizeTool(writer, 'docs_submit_article', {}), 'user:writer');
const priorWriteToken = process.env.GITHUB_TOKEN;
const priorReadToken = process.env.GITHUB_READ_TOKEN;
try {
  process.env.GITHUB_TOKEN = 'write-only-fixture';
  process.env.GITHUB_READ_TOKEN = 'read-only-fixture';
  const result = await searchProductContext('atendimento', 'atendimento', { fetch: async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer read-only-fixture', 'dedicated read token takes precedence over legacy write token');
    return { ok: true, json: async () => ({ tree: [] }) };
  } });
  assert.equal(result.available, true);
} finally {
  if (priorWriteToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = priorWriteToken;
  if (priorReadToken === undefined) delete process.env.GITHUB_READ_TOKEN;
  else process.env.GITHUB_READ_TOKEN = priorReadToken;
}
const quotaWindow = Date.now() + 61_000;
for (let index = 0; index < 30; index += 1) authorizeTool(writer, 'docs_submit_article', {}, { now: quotaWindow, limit: 30 });
assert.throws(() => authorizeTool(writer, 'docs_submit_article', {}, { now: quotaWindow, limit: 30 }), /rate limit/i, 'per actor quota is independent of IP');

const contentRoot = await mkdtemp(join(tmpdir(), 'm514-content-'));
const stateRoot = await mkdtemp(join(tmpdir(), 'm514-state-'));
const oldState = process.env.MCP_STATE_DIR;
process.env.MCP_STATE_DIR = stateRoot;
const article = {
  path: 'docs/teste/persistencia', title: 'Persistência do MCP',
  description: 'Guia de teste da persistência do draft fora do conteúdo imutável.',
  source: 'produto', contentType: 'faq',
  body: Array(70).fill('Conteúdo de teste para validar o armazenamento persistente com revisão.').join(' '),
};
try {
  const draft = await submitArticle(contentRoot, article, 'draft', writer.actor);
  assert.equal(draft.status, 'draft');
  await auditOperation(contentRoot, { actor: writer.actor, operation: 'docs_product_context', result: 'success' });
  const replacementContentRoot = await mkdtemp(join(tmpdir(), 'm514-replacement-'));
  assert.match(await readFile(join(stateRoot, '.drafts/docs/teste/persistencia.mdx'), 'utf8'), /Persistência do MCP/, 'draft survives content replacement');
  assert.match(await readFile(join(stateRoot, '.audit/docs-submissions.jsonl'), 'utf8'), /user:writer/, 'audit survives restart');
  await assert.rejects(stat(join(contentRoot, '.audit/docs-submissions.jsonl')), /ENOENT/, 'audit must not be written under /app content');
  await assert.rejects(submitArticle(replacementContentRoot, article, 'draft', writer.actor), /Draft já existe/, 'restart sees the same draft');
} finally {
  if (oldState === undefined) delete process.env.MCP_STATE_DIR;
  else process.env.MCP_STATE_DIR = oldState;
}
