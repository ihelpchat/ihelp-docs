import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const review = await import('./security-review.mjs').catch(() => ({}));
import { submitArticle, submitContentPackage } from './content-service.mjs';
import { renderApiReference } from './api-reference-render.mjs';
import { McpServer } from '@modelcontextprotocol/server';
import { buildServer } from './server.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const article = { path: 'api/teste/contato', title: 'Consultar contato',
  description: 'Consulte os dados de um contato pelo identificador informado.',
  source: 'api', contentType: 'referencia', method: 'GET', endpoint: '/contacts',
  body: '## Exemplo\n\n```http\nGET https://apiv3.ihelpchat.com/api/v2/contacts/id-exemplo-1\n```\n\nExemplo fictício.' };
const facts = { parameters: [{ name: 'id', in: 'route', type: 'string' }] };
const examine = (candidate = article, input = {}) => {
  assert.equal(typeof review.securityReview, 'function');
  return review.securityReview(candidate, { facts: input.facts ?? facts, request: input });
};

test('docs_generate_package revisa página docs antes de devolvê-la', async () => {
  const body = 'Abra a tela de contatos, escolha a opção de consulta e confira os dados exibidos. '.repeat(9);
  const safe = { path: 'docs/teste/consulta', title: 'Consultar contatos',
    description: 'Aprenda a consultar os contatos cadastrados no iHelp.', source: 'produto', contentType: 'faq',
    assistantQuestion: 'Como consultar contatos?', assistantOverview: 'Abra Contatos, procure a pessoa na lista e confira os dados antes de continuar.',
    assistantInitialSteps: 1, assistantSuggestions: ['Como buscar um contato?'], body,
    productActions: [], grounding: [] };
  const request = { topic: 'Consultar contatos', module: 'Contatos', description: 'Explicar a consulta de contatos.' };
  const productContext = { groundingRequired: false, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] };
  const generate = async (candidate) => generateContentPackage(process.cwd(), request, {
    productContext, plan: { status: 'ready' },
    client: { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
      status: 'ready', summary: 'Consulta de contatos.', questions: [], articles: [candidate], grounding: [],
    }) }) } },
  });
  const allowed = await generate(safe);
  assert.equal(allowed.status, 'ready', allowed.questions?.join('; '));
  assert.equal(allowed.articles.length, 1);
  const blocked = await generate({ ...safe, body: `${body} https://10.0.0.5/internal` });
  assert.notEqual(blocked.status, 'ready');
  assert.deepEqual(blocked.articles, []);
  assert.match(blocked.questions.join(' '), /URL ou host fora da API pública/iu);
});

async function backendFixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'm556-back-'));
  const backend = join(root, 'back');
  const dir = join(backend, 'Comzada.Application/Controllers/V2');
  await mkdir(dir, { recursive: true });
  await mkdir(join(root, 'content/docs'), { recursive: true });
  await mkdir(join(root, 'architecture'), { recursive: true });
  await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: [] }));
  await writeFile(join(root, 'architecture/coverage-matrix.json'), '[]');
  await writeFile(join(dir, 'ContactsController.cs'), `[ApiVersion("2")][Route("api/v{version:apiVersion}/contacts")]
public class ContactsController {
  [HttpPost] public IActionResult Post([FromBody] ContactRequest body) { return null; }
  [HttpDelete] public IActionResult Delete() { return null; }
  [HttpDelete("delete-a")] public IActionResult DeleteA() { return null; }
  [HttpDelete("delete-b")] public IActionResult DeleteB() { return null; }
}
public class ContactRequest { public string id { get; set; } }`);
  execFileSync('git', ['init', '-q', backend]);
  execFileSync('git', ['-C', backend, 'add', '.']);
  execFileSync('git', ['-C', backend, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  return { root, backend };
}

test('API POST sem fatos para antes da revisão de campos; com fatos confere serverAssigned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm556-no-facts-'));
  await mkdir(join(root, 'content/docs'), { recursive: true });
  const candidate = { ...article, method: 'POST', body: `${article.body}\n\n\`\`\`json\n{"id":"id-exemplo-1"}\n\`\`\`` };
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  process.env.BACKEND_LOCAL_CHECKOUT = join(root, 'missing-back');
  try {
    const missing = await submitContentPackage(root, [candidate], 'dry_run', 'user:tester');
    assert.equal(missing.status, 'needs_information');
    assert.match(missing.questions.join(' '), /sem fatos do código para conferir os campos do endpoint POST \/contacts/iu);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
  }
  assert.match(examine(candidate, { facts: { parameters: [{ name: 'id', in: 'body', serverAssigned: true }] } }).blocks.join(' '), /id.*serverAssigned/iu);
});

test('draft de submitArticle revisa host fora de api antes de escrever e aceita host público', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm556-draft-'));
  await mkdir(join(root, 'content/docs'), { recursive: true });
  const safe = { ...article, path: 'docs/teste/consulta', source: 'produto', contentType: 'guia',
    body: `${article.body} ${'Esta orientação apresenta um exemplo seguro para consultar contatos no iHelp. '.repeat(9)}` };
  const unsafe = { ...safe, body: safe.body.replace('https://apiv3.ihelpchat.com', 'https://10.0.0.5/internal') };
  await assert.rejects(submitArticle(root, unsafe, 'draft', 'user:tester'), /URL ou host fora da API pública/iu);
  const path = join(root, '.drafts/docs/teste/consulta.mdx');
  await assert.rejects(access(path), { code: 'ENOENT' });
  assert.equal((await submitArticle(root, safe, 'draft', 'user:tester')).status, 'draft');
  await access(path);
});

test('pacote exige confirmação por DELETE e rejeita item alheio', async () => {
  const { root, backend } = await backendFixture();
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  process.env.BACKEND_LOCAL_CHECKOUT = backend;
  const items = ['delete-a', 'delete-b'].map((suffix) => ({ ...article, path: `api/teste/${suffix}`, method: 'DELETE', endpoint: `/api/v2/contacts/${suffix}`,
    body: article.body.replace('GET https://apiv3.ihelpchat.com/api/v2/contacts/id-exemplo-1', `DELETE https://apiv3.ihelpchat.com/api/v2/contacts/${suffix}`) }));
  const both = ['DELETE /api/v2/contacts/delete-a', 'DELETE /api/v2/contacts/delete-b'];
  try {
    assert.equal((await submitContentPackage(root, items, 'dry_run', 'user:tester', [], { confirmations: both })).status, 'dry_run');
    const one = await submitContentPackage(root, items, 'dry_run', 'user:tester', [], { confirmations: both.slice(0, 1) });
    assert.equal(one.status, 'needs_information');
    assert.match(one.questions.join(' '), /DELETE \/api\/v2\/contacts\/delete-b/iu);
    await assert.rejects(submitContentPackage(root, items, 'dry_run', 'user:tester', [], { confirmations: [...both, 'DELETE /api/v2/contacts/other'] }), /DELETE \/api\/v2\/contacts\/other.*não corresponde|não corresponde.*DELETE \/api\/v2\/contacts\/other/iu);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
  }
});

test('uma página com dois endpoints citados exige fatos e confirmação de ambos', async () => {
  const { root, backend } = await backendFixture();
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  process.env.BACKEND_LOCAL_CHECKOUT = backend;
  const candidate = { ...article, method: 'DELETE', endpoint: '/api/v2/contacts/delete-a',
    body: '## Exemplo\n\nDELETE /api/v2/contacts/delete-a\n\nO pacote também documenta DELETE /api/v2/contacts/delete-b. Exemplo fictício.' };
  try {
    const result = await submitContentPackage(root, [candidate], 'dry_run', 'user:tester', [],
      { confirmations: ['DELETE /api/v2/contacts/delete-a'] });
    assert.equal(result.status, 'needs_information');
    assert.match(result.questions.join(' '), /DELETE \/api\/v2\/contacts\/delete-b/u);
    assert.equal((await submitContentPackage(root, [candidate], 'dry_run', 'user:tester', [],
      { confirmations: ['DELETE /api/v2/contacts/delete-a', 'DELETE /api/v2/contacts/delete-b'] })).status, 'dry_run');
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
  }
});

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
  const { root, backend } = await backendFixture();
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  process.env.BACKEND_LOCAL_CHECKOUT = backend;
  const writes = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (...args) => { writes.push(args); throw Error('GitHub não pode ser chamado'); };
  try {
    const destructive = { ...article, method: 'DELETE', endpoint: '/api/v2/contacts', body: article.body.replace('GET https://apiv3.ihelpchat.com/api/v2/contacts/id-exemplo-1', 'DELETE https://apiv3.ihelpchat.com/api/v2/contacts') };
    const result = await submitContentPackage(root, [destructive], 'pull_request', 'user:tester');
    assert.equal(result.status, 'needs_information');
    assert.match(result.securityWarnings.join(' '), /DELETE/iu);
    assert.match(result.questions.join(' '), /DELETE \/api\/v2\/contacts/iu);
    assert.equal(writes.length, 0);
  } finally { globalThis.fetch = before;
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT; else process.env.BACKEND_LOCAL_CHECKOUT = previous; }
});

test('DELETE confirmado segue e PR contém Atenção de segurança', async () => {
  const { root, backend } = await backendFixture();
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  process.env.BACKEND_LOCAL_CHECKOUT = backend;
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
    const result = await submitContentPackage(root, [{ ...article, method: 'DELETE', endpoint: '/api/v2/contacts', body: article.body.replace('GET https://apiv3.ihelpchat.com/api/v2/contacts/id-exemplo-1', 'DELETE https://apiv3.ihelpchat.com/api/v2/contacts') }], 'pull_request', 'user:tester', [],
      { confirmations: ['DELETE /api/v2/contacts'] });
    assert.equal(result.status, 'pull_request');
    assert.match(result.securityWarnings.join(' '), /DELETE/iu);
    const pull = calls.find(({ url, init }) => url.endsWith('/pulls') && init.method === 'POST');
    assert.match(JSON.parse(pull.init.body).body, /Atenção de segurança/iu);
  } finally { globalThis.fetch = before; if (oldToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldToken;
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT; else process.env.BACKEND_LOCAL_CHECKOUT = previous; }
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

test('gramática numérica e nomes em zonas de exemplo bloqueiam com motivo', () => {
  const base = { ...article, body: `${article.body}\n\nExemplo: pessoa Maria Exemplo` };
  assert.deepEqual(examine(base).blocks, []);
  for (const [name, body, reason] of [
    ['CNPJ', `${base.body}\n\nCNPJ 12.345.678/0001-95`, /dado pessoal/iu],
    ['CPF', `${base.body}\n\nCPF 123.456.789-09`, /dado pessoal/iu],
    ['telefone', `${base.body}\n\n(17) 99261-0896`, /dado pessoal/iu],
    ['nome em prosa de exemplo', base.body.replace('Maria Exemplo', 'João Silva'), /nome de pessoa/iu],
    ['nome em Ex.:', base.body.replace('Exemplo: pessoa Maria Exemplo', 'Ex.: pessoa João Silva'), /nome de pessoa/iu],
    ['nome em Por exemplo', base.body.replace('Exemplo: pessoa Maria Exemplo', 'Por exemplo, pessoa João Silva'), /nome de pessoa/iu],
    ['nome em JSON', `${base.body}\n\n` + '```json\n{"name":"João Silva"}\n```', /nome de pessoa/iu],
    ['nome em código inline', `${base.body}\n\n` + '`João Silva`', /nome de pessoa/iu],
  ]) assert.match(examine({ ...base, body }).blocks.join(' '), reason, name);
  for (const [name, body] of [
    ['sintético', `${base.body}\n\n5500000000000`],
    ['data ISO', `${base.body}\n\n2026-09-27T10:00:00Z`],
    ['termo do produto', base.body.replace('Maria Exemplo', 'WhatsApp Business')],
  ]) assert.deepEqual(examine({ ...base, body }).blocks, [], name);
});

test('status HTTP e siglas em exemplos passam; nomes de pessoa equivalentes bloqueiam', () => {
  const jsonStatus = { ...article, body: '## Exemplo\n\n```json\n{"message":"Not Found"}\n```' };
  assert.deepEqual(examine(jsonStatus).blocks, []);
  assert.match(examine({ ...jsonStatus, body: jsonStatus.body.replace('Not Found', 'João Silva') }).blocks.join(' '), /nome de pessoa/iu);

  const acronym = { ...article, body: 'Exemplo: "ID DO GRUPO"' };
  assert.deepEqual(examine(acronym).blocks, []);
  assert.match(examine({ ...acronym, body: acronym.body.replace('"ID DO GRUPO"', 'pessoa João Silva') }).blocks.join(' '), /nome de pessoa/iu);
});

test('CNPJ em draft bloqueia antes de qualquer escrita no disco', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm556-cnpj-'));
  await mkdir(join(root, 'content/docs'), { recursive: true });
  const safe = { ...article, path: 'docs/teste/consulta', source: 'produto', contentType: 'guia',
    body: `${article.body} ${'Esta orientação apresenta um exemplo seguro para consultar contatos no iHelp. '.repeat(9)}` };
  assert.deepEqual(examine(safe).blocks, []);
  const unsafe = { ...safe, body: `${safe.body}\n\nCNPJ 12.345.678/0001-95` };
  await assert.rejects(submitArticle(root, unsafe, 'draft', 'user:tester'), /dado pessoal/iu);
  await assert.rejects(access(join(root, '.drafts/docs/teste/consulta.mdx')), { code: 'ENOENT' });
});

test('GET com showAll no corpo avisa mesmo quando também menciona limit', () => {
  const candidate = { ...article, body: `${article.body}\n\nGET /contacts?showAll=true&limit=50` };
  assert.deepEqual(examine().warnings, []);
  assert.match(examine(candidate).warnings.join(' '), /todos os dados|showAll|volume/iu);
});

test('ferramentas mutates herdam confirmations e DELETE confirmado segue via docs_submit_article', async () => {
  const { root, backend } = await backendFixture();
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  process.env.BACKEND_LOCAL_CHECKOUT = backend;
  const registered = new Map();
  const original = McpServer.prototype.registerTool;
  McpServer.prototype.registerTool = function (name, config, callback) {
    registered.set(name, { config, callback });
    return original.call(this, name, config, callback);
  };
  try { buildServer(root); }
  finally { McpServer.prototype.registerTool = original; }
  for (const [name, { config }] of registered) if (config.mutates)
    assert.equal(config.inputSchema.shape.confirmations?.safeParse(['DELETE /api/v2/contacts']).success, true,
      `${name} aceita confirmations`);
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
    const result = await tool({ ...article, method: 'DELETE', endpoint: '/api/v2/contacts', body: article.body.replace('GET https://apiv3.ihelpchat.com/api/v2/contacts/id-exemplo-1', 'DELETE https://apiv3.ihelpchat.com/api/v2/contacts'), mode: 'pull_request', requestedBy: 'user:tester', confirmations: ['DELETE /api/v2/contacts'] });
    assert.equal(JSON.parse(result.content[0].text).status, 'pull_request');
    assert.ok(writes > 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = priorToken;
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT; else process.env.BACKEND_LOCAL_CHECKOUT = previous;
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
    assert.match(JSON.stringify(result.content), /sem fatos do código para conferir os campos do endpoint GET \/contacts\/\{id\}/iu);
  } finally {
    McpServer.prototype.registerTool = original;
    if (prior === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT; else process.env.BACKEND_LOCAL_CHECKOUT = prior;
  }
});
