import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submitContentPackage } from './content-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'ihelp-delete-only-'));
const files = new Map([
  ['pilot/content/docs/docs/contatos/meta.json', '{"pages":["index","antigo"]}\n'],
  ['pilot/content/docs/docs/contatos/antigo.mdx', 'artigo antigo'],
]);
const calls = [];
let fetchCount = 0;
const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;
process.env.GITHUB_TOKEN = 'mock-token';
globalThis.fetch = async (url, init = {}) => {
  fetchCount += 1;
  const path = new URL(url).pathname;
  const method = init.method ?? 'GET';
  if (path.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: 'base-sha' } }) };
  if (path.endsWith('/git/refs')) { calls.push({ method, path, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({}) }; }
  if (path.endsWith('/pulls')) {
    calls.push({ method, path, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/322' }) };
  }
  const file = decodeURIComponent(path.split('/contents/')[1] ?? '');
  if (!file) throw Error(`Unexpected GitHub call: ${method} ${path}`);
  if (method === 'GET') return files.has(file)
    ? { ok: true, json: async () => ({ sha: `sha-${file}`, encoding: 'base64', content: Buffer.from(files.get(file)).toString('base64') }) }
    : { ok: false, status: 404, json: async () => ({}) };
  const body = JSON.parse(init.body);
  calls.push({ method, file, body });
  if (method === 'DELETE') { files.delete(file); return { ok: true, json: async () => ({}) }; }
  if (method === 'PUT') { files.set(file, Buffer.from(body.content, 'base64').toString()); return { ok: true, json: async () => ({}) }; }
  throw Error(`Unexpected method: ${method}`);
};

try {
  for (const path of ['docs/contatos/cpf12345678909', 'docs/contatos/contato11987654321x']) {
    await assert.rejects(submitContentPackage(root, [], 'pull_request', 'user:tester', [path]), /dado pessoal/i);
    assert.equal(fetchCount, 0, 'delete com dado sensível não pode acessar GitHub');
  }
  const beforeMissing = fetchCount;
  await assert.rejects(submitContentPackage(root, [], 'pull_request', 'user:tester', ['docs/contatos/inexistente']), /Artigo não encontrado/i);
  assert.equal(calls.length, 0, 'delete inexistente não pode criar branch, alterar arquivo ou abrir PR');
  assert.ok(fetchCount > beforeMissing, 'existência deve ser consultada na base');
  const result = await submitContentPackage(root, [], 'pull_request', 'user:tester', ['docs/contatos/antigo']);
  assert.equal(result.status, 'pull_request');
  assert.deepEqual(result.articles, []);
  assert.deepEqual(result.deleted, ['docs/contatos/antigo']);
  assert.equal(files.has('pilot/content/docs/docs/contatos/antigo.mdx'), false);
  assert.deepEqual(JSON.parse(files.get('pilot/content/docs/docs/contatos/meta.json')).pages, ['index']);
  const pull = calls.filter(({ path }) => path?.endsWith('/pulls'));
  assert.equal(pull.length, 1, 'delete-only precisa abrir exatamente uma PR');
  assert.match(pull[0].body.title, /^docs: remove /);
  assert.doesNotMatch(pull[0].body.title, /undefined|\[object Object\]/);
} finally {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
}

console.log('Pacote delete-only criou PR com título seguro e atualizou meta.json.');
