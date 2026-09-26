import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const readerKey = 'reader-http-abcdefghijklmnopqrstuvwxyz-123456';
const writerKey = 'writer-http-abcdefghijklmnopqrstuvwxyz-123456';
process.env.DOCS_MCP_CREDENTIALS = JSON.stringify([
  { actor: 'user:reader-http', role: 'reader', key: readerKey },
  { actor: 'user:writer-http', role: 'writer', key: writerKey },
]);
process.env.MCP_STATE_DIR = await mkdtemp(join(tmpdir(), 'm514-http-state-'));
process.env.PORT = '0';
const { httpServer } = await import('./http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
const url = new URL(`http://127.0.0.1:${httpServer.address().port}/mcp`);
const connect = async (key) => {
  const client = new Client({ name: 'm514-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: { token: async () => key } }));
  return client;
};
let reader;
let writer;
try {
  const unauthorized = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer revoked-key-abcdefghijklmnopqrstuvwxyz-123456' } });
  assert.equal(unauthorized.status, 401);
  reader = await connect(readerKey);
  writer = await connect(writerKey);
  const read = await reader.callTool({ name: 'docs_inventory', arguments: {} });
  assert.equal(read.isError, false);
  const deniedWrite = await reader.callTool({ name: 'docs_delete_article', arguments: { path: 'docs/teste/ausente', mode: 'draft', requestedBy: 'user:reader-http' } });
  assert.equal(deniedWrite.isError, true);
  assert.match(deniedWrite.content[0].text, /forbidden/);
  const deniedPrivateRead = await writer.callTool({ name: 'docs_product_context', arguments: { topic: 'atendimento', module: 'atendimento', requestedBy: 'user:writer-http' } });
  assert.equal(deniedPrivateRead.isError, true);
  assert.match(deniedPrivateRead.content[0].text, /forbidden/);
  const forged = await writer.callTool({ name: 'docs_delete_article', arguments: { path: 'docs/teste/ausente', mode: 'draft', requestedBy: 'user:reader-http' } });
  assert.equal(forged.isError, true);
  assert.match(forged.content[0].text, /requestedBy/);
} finally {
  await reader?.close();
  await writer?.close();
  await new Promise((resolve) => httpServer.close(resolve));
}
