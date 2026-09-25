import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readArticle } from './editorial-standard.mjs';

const sourceRoot = new URL('../', import.meta.url).pathname;
const root = await mkdtemp(join(tmpdir(), 'm5-01-roundtrip-'));
const paths = [
  'docs/principais-motivos-de-suporte/reconectar-canal-qr',
  'docs/principais-motivos-de-suporte/crm',
  'api/crm/visoes-salvas/atualizar-visao-salva',
  'blog/encerramento-automatico-e-filtros',
];
for (const path of paths) {
  const file = join(root, 'content/docs', `${path}.mdx`);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, await readFile(join(sourceRoot, 'content/docs', `${path}.mdx`)));
}
const mock = join(root, 'github-mock.mjs');
await writeFile(mock, `import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.env.DOCS_ROOT;
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const method = init.method ?? 'GET';
  if (path.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: 'base-sha' } }) };
  if (path.endsWith('/git/refs')) return { ok: true, json: async () => ({}) };
  if (path.endsWith('/pulls')) return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/123' }) };
  const file = decodeURIComponent(path.split('/contents/')[1] ?? '');
  if (!file) throw Error('Unexpected GitHub request');
  const target = join(root, 'remote', file);
  if (method === 'GET') {
    try {
      const content = await readFile(target);
      return { ok: true, json: async () => ({ sha: 'existing-sha', content: content.toString('base64') }) };
    } catch { return { ok: false, status: 404 }; }
  }
  if (method !== 'PUT') throw Error('Unexpected GitHub write');
  const payload = JSON.parse(init.body);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, Buffer.from(payload.content, 'base64'));
  await writeFile(join(root, 'writes.log'), file + '\\n', { flag: 'a' });
  return { ok: true, json: async () => ({}) };
};`);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', mock, join(sourceRoot, 'mcp/server.mjs')],
  cwd: sourceRoot,
  env: { ...process.env, DOCS_ROOT: root, GITHUB_TOKEN: 'mock-token', GITHUB_BASE_BRANCH: 'integration/claricia-v2' },
  stderr: 'pipe',
});
const client = new Client({ name: 'm5-01-roundtrip', version: '1.0.0' });
await client.connect(transport);
const call = (name, args) => client.callTool({ name, arguments: args });
try {
  for (const path of paths) {
    const original = await readArticle(root, path);
    if (path.includes('reconectar-canal-qr')) {
      original.assistantIntent = 'reconnect_qr';
      original.assistantSuggestions = 'Como confirmar que o canal voltou a funcionar?';
    }
    if (path.endsWith('/crm')) original.assistantSuggestions = 'Como confirmar que a pipeline foi criada?';
    const result = await call('docs_update_article', { ...original, requestedBy: 'service:roundtrip' });
    assert.equal(result.isError, false, `${path}: ${result.content[0].text}`);
    const remote = join(root, 'remote/pilot/content/docs', `${path}.mdx`);
    const rendered = await readFile(remote, 'utf8');
    const updated = join(root, 'content/docs', `${path}.mdx`);
    await writeFile(updated, rendered);
    const reread = await readArticle(root, path);
    for (const field of Object.keys(original).filter((key) => key !== 'body' && key !== 'path')) {
      assert.deepEqual(reread[field], original[field], `${path}: ${field} perdido`);
    }
    assert.equal((rendered.match(/<ProductAction\b/g) ?? []).length, (original.body.match(/<ProductAction\b/g) ?? []).length, `${path}: ProductAction duplicado`);
    const meta = JSON.parse(await readFile(join(root, 'remote/pilot/content/docs', path.split('/').slice(0, -1).join('/'), 'meta.json')));
    assert.equal(meta.pages.filter((page) => page === path.split('/').at(-1)).length, 1, `${path}: menu incorreto`);
  }
  const individual = await readArticle(root, paths[0]);
  const newPath = 'docs/principais-motivos-de-suporte/novo-guia';
  const submitted = await call('docs_submit_article', { ...individual, path: newPath, mode: 'pull_request', requestedBy: 'service:roundtrip' });
  assert.equal(submitted.isError, false, `submit individual: ${submitted.content[0].text}`);
  const individualMeta = JSON.parse(await readFile(join(root, 'remote/pilot/content/docs/docs/principais-motivos-de-suporte/meta.json')));
  assert.equal(individualMeta.pages.filter((page) => page === 'novo-guia').length, 1, 'submit individual precisa atualizar meta.json pelo pacote');
  const before = await readFile(join(root, 'writes.log'), 'utf8');
  const original = await readArticle(root, paths[0]);
  const rejected = await call('docs_submit_article', { ...original, body: `${original.body}\n<ProductAction id="abrir-canais" label="Abrir a tela Canais" route="/configuracoes/channel" />`, mode: 'pull_request', requestedBy: 'service:roundtrip' });
  assert.equal(rejected.isError, true, 'submit individual deve rejeitar ProductAction duplicado');
  assert.equal(await readFile(join(root, 'writes.log'), 'utf8'), before, 'rejeição não pode escrever no GitHub');
} finally {
  await client.close();
}
console.log('M5.01: roundtrip de QR, CRM, API e blog; menu e rejeição sem writes.');
