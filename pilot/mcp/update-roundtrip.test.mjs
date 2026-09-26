import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readArticle } from './editorial-standard.mjs';
import { parseDocument } from 'yaml';
import { docsPageSchema } from '../lib/docs-page-schema.mjs';
import { renderArticle, validateArticle } from './content-service.mjs';
import { articleSchema } from './article-fields.mjs';

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
    const originalMdx = await readFile(join(root, 'content/docs', `${path}.mdx`), 'utf8');
    const originalYaml = parseDocument(originalMdx.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').toJS();
    if (path.includes('reconectar-canal-qr')) {
      original.assistantIntent = 'reconnect_qr';
      original.assistantSuggestions = ['Abra CRM | Pipeline: "visão" #1', 'Como falar com uma pessoa?'];
      original.productActions = [{ id: 'abrir-canais', label: 'Abrir a tela Canais', route: '/configuracoes/channel' }];
      originalYaml.assistantIntent = original.assistantIntent;
      originalYaml.assistantSuggestions = original.assistantSuggestions;
    }
    if (path.endsWith('/crm')) {
      original.assistantSuggestions = ['Como confirmar que a pipeline foi criada?'];
      originalYaml.assistantSuggestions = original.assistantSuggestions;
    }
    const result = await call('docs_update_article', { ...original, requestedBy: 'service:roundtrip' });
    assert.equal(result.isError, false, `${path}: ${result.content[0].text}`);
    const remote = join(root, 'remote/pilot/content/docs', `${path}.mdx`);
    const rendered = await readFile(remote, 'utf8');
    if (path.includes('reconectar-canal-qr')) {
      const actionAt = rendered.indexOf('<ProductAction id="abrir-canais"');
      const firstStepAt = rendered.indexOf('1. Abra Canais');
      assert.ok(actionAt >= 0 && firstStepAt >= 0 && actionAt < firstStepAt, 'ProductAction existente deve permanecer antes do primeiro passo');
      assert.equal((rendered.match(/<ProductAction\b/g) ?? []).length, 1, 'ação estruturada e inline devem produzir uma ação');
    }
    const frontmatter = parseDocument(rendered.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').toJS();
    const parsed = docsPageSchema.safeParse(frontmatter);
    assert.equal(parsed.success, true, `${path}: MDX gerado falha no schema real da Central: ${parsed.success ? '' : parsed.error.message}`);
    for (const [key, value] of Object.entries(originalYaml)) {
      assert.deepEqual(frontmatter[key], value, `${path}: tipo YAML de ${key} mudou`);
    }
    const updated = join(root, 'content/docs', `${path}.mdx`);
    await writeFile(updated, rendered);
    const reread = await readArticle(root, path);
    for (const field of Object.keys(original).filter((key) => !['body', 'path', 'productActions'].includes(key))) {
      assert.deepEqual(reread[field], original[field], `${path}: ${field} perdido`);
    }
    assert.equal((rendered.match(/<ProductAction\b/g) ?? []).length, (original.body.match(/<ProductAction\b/g) ?? []).length, `${path}: ProductAction duplicado`);
    const meta = JSON.parse(await readFile(join(root, 'remote/pilot/content/docs', path.split('/').slice(0, -1).join('/'), 'meta.json')));
    assert.equal(meta.pages.filter((page) => page === path.split('/').at(-1)).length, 1, `${path}: menu incorreto`);
  }
  const individual = await readArticle(root, paths[0]);
  individual.full = true;
  const newPath = 'docs/principais-motivos-de-suporte/novo-guia';
  const submitted = await call('docs_submit_article', { ...individual, path: newPath, productActions: [{ id: 'abrir-canais', label: 'Abrir a tela Canais', route: '/configuracoes/channel' }], mode: 'pull_request', requestedBy: 'service:roundtrip' });
  assert.equal(submitted.isError, false, `submit individual: ${submitted.content[0].text}`);
  const individualMdx = await readFile(join(root, 'remote/pilot/content/docs', `${newPath}.mdx`), 'utf8');
  const individualFrontmatter = parseDocument(individualMdx.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').toJS();
  assert.equal(individualFrontmatter.full, true, 'booleano conhecido do frontmatter precisa continuar booleano');
  assert.equal((individualMdx.match(/<ProductAction\b/g) ?? []).length, 1, 'ProductAction inline e estruturado não podem duplicar');
  const individualMeta = JSON.parse(await readFile(join(root, 'remote/pilot/content/docs/docs/principais-motivos-de-suporte/meta.json')));
  assert.equal(individualMeta.pages.filter((page) => page === 'novo-guia').length, 1, 'submit individual precisa atualizar meta.json pelo pacote');
  const before = await readFile(join(root, 'writes.log'), 'utf8');
  const privateArticle = { ...individual, path: 'docs/principais-motivos-de-suporte/autores-privados', authors: ['pessoa@example.com'] };
  assert.ok(validateArticle(privateArticle).issues.some((issue) => /dado pessoal/i.test(issue)), 'array no frontmatter deve ser inspecionado');
  assert.throws(() => renderArticle(privateArticle), /dado pessoal/i, 'render deve rejeitar dado pessoal no array');
  const privateResult = await call('docs_submit_article', { ...privateArticle, mode: 'pull_request', requestedBy: 'service:roundtrip' });
  assert.equal(privateResult.isError, true, 'submit deve rejeitar e-mail em authors');
  assert.equal(await readFile(join(root, 'writes.log'), 'utf8'), before, 'e-mail em authors deve causar zero writes');
  for (const [field, value] of [['telefone', 11987654321], ['senha', 'Ihelp2026!']]) {
    const unsafe = { ...individual, path: `docs/principais-motivos-de-suporte/${field}-privado`, [field]: value };
    const response = await call('docs_submit_article', { ...unsafe, mode: 'pull_request', requestedBy: 'service:roundtrip' });
    assert.equal(response.isError, true, `${field} desconhecido deve ser rejeitado`);
    assert.equal(await readFile(join(root, 'writes.log'), 'utf8'), before, `${field} deve causar zero writes`);
  }
  const unknown = await call('docs_update_article', { ...individual, campoDesconhecido: 'valor', requestedBy: 'service:roundtrip' });
  assert.equal(unknown.isError, true, 'update não pode aceitar campo desconhecido');
  assert.equal(await readFile(join(root, 'writes.log'), 'utf8'), before, 'campo desconhecido deve causar zero writes');
  assert.equal(articleSchema.safeParse({ ...individual, campoDesconhecido: 'valor' }).success, false, 'schema MCP precisa rejeitar campo desconhecido');
  const unknownPath = 'docs/principais-motivos-de-suporte/legado-desconhecido';
  const unknownFile = join(root, 'content/docs', `${unknownPath}.mdx`);
  await writeFile(unknownFile, (await readFile(join(root, 'content/docs', `${paths[0]}.mdx`), 'utf8')).replace('\n---\n\n', '\ncampoDesconhecido: valor\n---\n\n'));
  await assert.rejects(readArticle(root, unknownPath), /campo desconhecido/i, 'leitor usa a mesma lista fechada');

  const canonical = { id: 'abrir-canais', label: 'Abrir a tela Canais', route: '/configuracoes/channel' };
  const inline = '<ProductAction id="abrir-canais" label="Abrir a tela Canais" route="/configuracoes/channel" />';
  const invalidPackages = [
    ['metadado inválido', { icon: null }],
    ['atributo desconhecido', { body: `${individual.body}\n<ProductAction id="abrir-canais" label="Abrir a tela Canais" route="/configuracoes/channel" onclick="x" />` }],
    ['ação fora do catálogo', { body: `${individual.body}\n<ProductAction id="abrir-canais" label="Outro texto" route="/configuracoes/channel" />` }],
    ['ação duplicada', { body: `${individual.body}\n${inline}` }],
    ['ação divergente', { body: individual.body, productActions: [{ ...canonical, label: 'Outro texto' }] }],
    ['ação ausente', { body: individual.body, productActions: [{ id: 'abrir-crm', label: 'Abrir a tela Pipeline do CRM', route: '/crm/pipeline' }] }],
  ];
  for (const [reason, change] of invalidPackages) {
    const article = { ...individual, path: `docs/principais-motivos-de-suporte/rejeitar-${reason.replaceAll(' ', '-')}`, ...change };
    for (const mode of ['dry_run', 'draft', 'pull_request']) {
      const response = await call('docs_submit_package', { articles: [article], mode, requestedBy: 'service:roundtrip' });
      assert.equal(response.isError, true, `${reason} deve ser rejeitado em ${mode}`);
      assert.equal(await readFile(join(root, 'writes.log'), 'utf8'), before, `${reason} em ${mode} deve causar zero writes`);
      if (mode === 'draft') await assert.rejects(readFile(join(root, '.drafts', `${article.path}.mdx`)), { code: 'ENOENT' }, `${reason} não deve criar draft`);
    }
  }
  const individualDraftPath = 'docs/principais-motivos-de-suporte/draft-acao-invalida';
  const invalidDraft = { ...individual, path: individualDraftPath, body: `${individual.body}\n<ProductAction id="abrir-canais" label="Abrir a tela Canais" route="/configuracoes/channel" onclick="x" />` };
  const draftResult = await call('docs_submit_article', { ...invalidDraft, mode: 'draft', requestedBy: 'service:roundtrip' });
  assert.equal(draftResult.isError, true, 'submit individual em draft precisa validar o pacote');
  await assert.rejects(readFile(join(root, '.drafts', `${individualDraftPath}.mdx`)), { code: 'ENOENT' }, 'draft individual inválido não deve ser escrito');
  const original = await readArticle(root, paths[0]);
  const rejected = await call('docs_submit_article', { ...original, body: `${original.body}\n<ProductAction id="abrir-canais" label="Abrir a tela Canais" route="/configuracoes/channel" />`, mode: 'pull_request', requestedBy: 'service:roundtrip' });
  assert.equal(rejected.isError, true, 'submit individual deve rejeitar ProductAction duplicado');
  assert.equal(await readFile(join(root, 'writes.log'), 'utf8'), before, 'rejeição não pode escrever no GitHub');
} finally {
  await client.close();
}
console.log('M5.01: roundtrip de QR, CRM, API e blog; menu e rejeição sem writes.');
