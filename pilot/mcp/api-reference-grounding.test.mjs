import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { validateGroundedOutput, generateContentPackage } from './content-ai-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const contacts = `[Authorize]
[ApiVersion("2")]
[Route("api/v{version:apiVersion}/contacts")]
public class ContactsController {
  [HttpGet("{letter?}")]
  public Task<IActionResult> GetContactsAsync([FromRoute] string? letter, [FromQuery] Filters filters) { return null; }
  [HttpGet("details/{IdRef}")]
  public Task<IActionResult> GetContactDetailsAsync(string idRef) { return null; }
}`;
const tags = `[Authorize]
[ApiVersion("2")]
[Route("api/v{version:apiVersion}/contactTags")]
public class ContactsTagController {
  [HttpGet("getContactsTagByContactId/{contactId}")]
  public Task<IActionResult> GetContactsTagByContactId([FromRoute] int contactId) { return null; }
}`;
const dto = `public class Filters {
  public string SearchData { get; set; }
  public int Page { get; set; }
  public int Limit { get; set; }
}`;
const dtoSources = [{ file: 'Comzada.Domain/Filters.cs', source: dto }];
const endpoints = [
  ...readCsharpEndpoints(contacts, 'Controllers/ContactsController.cs', { dtoSources }),
  ...readCsharpEndpoints(tags, 'Controllers/ContactsTagController.cs', { dtoSources }),
];
const context = { groundingRequired: false, matches: [], code: [], endpoints };
const article = { source: 'api', contentType: 'referencia', method: 'GET', endpoint: '/contacts',
  body: '## Parâmetros\n<Params><Param name="searchData" type="string">Filtro</Param><Param name="page" type="number">Página</Param><Param name="limit" type="number">Limite</Param></Params>' };
test('pedido api sem fatos estruturados fica pendente antes do provider', async () => {
  const result = await generateContentPackage(process.cwd(), { topic: 'API de Contatos', module: 'api' }, {
    productContext: { ...context, endpoints: [] },
    client: { responses: { create() { throw new Error('provider não deveria ser chamado'); } } },
  });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), /endpoints estruturados/i);
});
test('rota inventada é rejeitada com motivo', () => {
  assert.equal(validateGroundedOutput(article, context, []), true);
  const issues = [];
  assert.equal(validateGroundedOutput({ ...article, endpoint: '/contacts/fake' }, context, [], issues), false);
  assert.match(issues.join(' '), /rota divergente/i);
});

test('parâmetro inexistente é rejeitado com motivo', () => {
  const issues = [];
  const changed = { ...article, body: article.body.replace('name="limit"', 'name="fake"') };
  assert.equal(validateGroundedOutput(changed, context, [], issues), false);
  assert.match(issues.join(' '), /parâmetro inexistente: fake/i);
});

test('resposta sem campos verificáveis não aceita JSON mesmo com nome de parâmetro conhecido', () => {
  const issues = [];
  const changed = { ...article, body: `${article.body}\n\n## Resposta\n\`\`\`json\n{"page":1}\n\`\`\`` };
  assert.equal(endpoints[0].responseFields, null);
  assert.equal(validateGroundedOutput(changed, context, [], issues), false);
  assert.match(issues.join(' '), /campos de resposta não verificáveis/i);
});

test('alias id da página de tags preserva a posição do parâmetro de rota', () => {
  const tagsArticle = { ...article, endpoint: '/contactTags/getContactsTagByContactId/{id}',
    body: '<Params><Param name="id" type="number">Contato</Param></Params>' };
  assert.equal(validateGroundedOutput(tagsArticle, context, []), true);
});

test('controller sem página pública exige confirmação', () => {
  const issues = [];
  const privateContext = { ...context, endpoints: endpoints.map((item) => ({ ...item, public: false })) };
  assert.equal(validateGroundedOutput(article, privateContext, [], issues), false);
  assert.match(issues.join(' '), /endpoint não público: confirmar/i);
});

test('controller privado no checkout retorna pendência sem entregar fatos ao gerador', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'api-private-test-'));
  const backend = join(root, 'back');
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  try {
    await mkdir(join(backend, 'Comzada.Application/Controllers/V2'), { recursive: true });
    await writeFile(join(backend, 'Comzada.Application/Controllers/V2/InternalController.cs'), `[Route("api/v{version:apiVersion}/internal")]
[ApiVersion("2")]
public class InternalController {
  [HttpGet("private/{id}")]
  public Task<IActionResult> Get([FromRoute] int id) { return null; }
}`);
    execFileSync('git', ['init', '-q', backend]);
    execFileSync('git', ['-C', backend, 'add', '.']);
    execFileSync('git', ['-C', backend, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    await mkdir(join(root, 'architecture'), { recursive: true });
    await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: [] }));
    await writeFile(join(root, 'architecture/coverage-matrix.json'), '[]');
    await mkdir(join(root, 'content/docs/api'), { recursive: true });
    process.env.BACKEND_LOCAL_CHECKOUT = backend;
    const productContext = await getIhelpContext(root, 'API internal', 'api', { requireLocal: true, repositoryIds: ['backend'] });
    assert.doesNotMatch(JSON.stringify(productContext), /private\/\{id\}|InternalController/);
    assert.equal(productContext.nonPublicEndpoints, true);
    const result = await generateContentPackage(root, { topic: 'API internal', module: 'api' }, {
      productContext, client: { responses: { create() { throw new Error('provider não deveria ser chamado'); } } },
    });
    assert.equal(result.status, 'needs_information');
    assert.match(result.questions.join(' '), /endpoint não público: confirmar/i);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('provider simulado não consegue devolver artigo com rota divergente', async () => {
  const generated = { ...article, path: 'api/contatos/buscar-contatos', title: 'Buscar contatos',
    description: 'Lista os contatos existentes da empresa com filtros e paginação.',
    endpoint: '/contacts/fake', productActions: [], grounding: [] };
  const payload = { status: 'ready', summary: 'Referência da API.', questions: [], articles: [generated], grounding: [] };
  const result = await generateContentPackage(process.cwd(), { topic: 'API de Contatos', module: 'api' }, {
    productContext: { ...context, endpoints: context.endpoints.map((item) => ({ ...item, public: true })) },
    plan: { status: 'ready', guidance: 'Use os endpoints.', questions: [] },
    client: { responses: { create: async () => ({ output_text: JSON.stringify(payload), model: 'simulado' }) } },
  });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), /rota divergente/i);
});

test('provider simulado entrega referência válida com método e endpoint', async () => {
  const generated = { ...article, path: 'api/contatos/buscar-contatos', title: 'Buscar contatos',
    description: 'Lista os contatos existentes da empresa com filtros e paginação.',
    body: `## Parâmetros\n<Params><Param name="searchData" type="string">Filtro</Param><Param name="page" type="number">Página</Param><Param name="limit" type="number">Limite</Param></Params>\n\n## Exemplo\n${'Use a busca de contatos com os filtros informados para consultar a lista da empresa. '.repeat(6)}\n\n## Resposta\nA resposta corresponde aos contatos encontrados.`,
    productActions: [], grounding: [] };
  const payload = { status: 'ready', summary: 'Referência da API.', questions: [], articles: [generated], grounding: [] };
  const result = await generateContentPackage(process.cwd(), { topic: 'API de Contatos', module: 'api' }, {
    productContext: { ...context, endpoints: context.endpoints.map((item) => ({ ...item, public: true })) },
    plan: { status: 'ready', guidance: 'Use os endpoints.', questions: [] },
    client: { responses: { create: async () => ({ output_text: JSON.stringify(payload), model: 'simulado' }) } },
  });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
  assert.deepEqual(result.articles.map(({ method, endpoint }) => [method, endpoint]), [['GET', '/contacts']]);
});

const verifiedEndpoint = { ...endpoints[0], public: true, responseFields: [{ name: 'name', type: 'string' }] };
const verifiedContext = { ...context, module: 'api', endpoints: [verifiedEndpoint] };
const verifiedArticle = { ...article, endpoint: verifiedEndpoint.route,
  body: `## Requisição\n\`GET\` \`${verifiedEndpoint.route}\`\n\`page\`\n\`Authorization\`\n\n\`\`\`bash\ncurl -X GET "https://example.test${verifiedEndpoint.route}?page=1" -H "Authorization: Bearer token"\n\`\`\`\n\n\`\`\`js\nfetch("${verifiedEndpoint.route}?page=1")\n\`\`\`\n\n## Resposta\nO campo name identifica o contato.\n\`\`\`json\n{"name":"Exemplo"}\n\`\`\`` };

test('referência completa aceita curl, fetch e JSON de resposta com fatos', () => {
  const issues = [];
  assert.equal(validateGroundedOutput(verifiedArticle, verifiedContext, [], issues), true, issues.join('; '));
});

for (const [label, mutate, reason] of [
  ['versão inventada', (a) => ({ ...a, endpoint: a.endpoint.replace('/v2/', '/v9/') }), /rota divergente/i],
  ['rota em prosa', (a) => ({ ...a, body: `${a.body}\nRota /api/v9/contacts.` }), /rota divergente.*v9/i],
  ['rota em fetch', (a) => ({ ...a, body: a.body.replace('fetch("/api/v2/', 'fetch("/api/v9/') }), /rota divergente.*v9/i],
  ['rota em curl', (a) => ({ ...a, body: a.body.replace('example.test/api/v2/', 'example.test/api/v9/') }), /rota divergente.*v9/i],
  ['JSON com chave inventada', (a) => ({ ...a, body: a.body.replace('"name":"Exemplo"', '"segredoInterno":"Exemplo"') }), /campo inexistente: segredoInterno/i],
  ['prosa com campo inventado', (a) => ({ ...a, body: a.body.replace('campo name', 'campo segredoInterno') }), /campo inexistente: segredoInterno/i],
  ['parâmetro de entrada como resposta', (a) => ({ ...a, body: a.body.replace('"name":"Exemplo"', '"page":1') }), /campo inexistente: page/i],
]) test(`gate API rejeita ${label}`, () => {
  const changed = mutate(verifiedArticle);
  const issues = [];
  assert.equal(validateGroundedOutput(changed, verifiedContext, [], issues), false);
  if (reason) assert.match(issues.join(' '), reason);
});

test('pedido api valida source produto com uma mudança no módulo', () => {
  const changed = { ...verifiedArticle, source: 'produto', body: verifiedArticle.body.replace('campo name', 'campo segredoInterno') };
  assert.equal(validateGroundedOutput(changed, { ...verifiedContext, module: 'docs' }, []), true);
  const issues = [];
  assert.equal(validateGroundedOutput(changed, verifiedContext, [], issues), false);
  assert.match(issues.join(' '), /campo inexistente: segredoInterno/i);
});

test('path api passa pelo gate mesmo com source e contentType diferentes', () => {
  const issues = [];
  const base = { ...verifiedArticle, source: 'produto', contentType: 'faq', path: 'docs/contatos/referencia', body: verifiedArticle.body.replace('campo name', 'campo segredoInterno') };
  const docsContext = { ...verifiedContext, module: 'docs' };
  assert.equal(validateGroundedOutput(base, docsContext, []), true);
  assert.equal(validateGroundedOutput({ ...base, path: 'api/contatos/referencia' }, docsContext, [], issues), false);
  assert.match(issues.join(' '), /campo inexistente: segredoInterno/i);
});

test('descrição e prosa de resposta sem DTO também passam pelo gate', () => {
  for (const changed of [
    { ...verifiedArticle, description: 'Use /api/v9/contacts para consultar.' },
    { ...article, body: `${article.body}\n\n## Resposta\nO campo page indica a página.` },
  ]) {
    const issues = [];
    assert.equal(validateGroundedOutput(changed, changed.description ? verifiedContext : context, [], issues), false);
    assert.match(issues.join(' '), changed.description ? /rota divergente.*v9/i : /campos de resposta não verificáveis.*page/i);
  }
});

test('rota versionada preserva nome do placeholder', () => {
  const versioned = { ...article, endpoint: endpoints[2].route, body: '## Parâmetros de rota\n<Params><Param name="contactId" type="number">Contato</Param></Params>' };
  assert.equal(validateGroundedOutput(versioned, context, []), true);
  const issues = [];
  assert.equal(validateGroundedOutput({ ...versioned, endpoint: versioned.endpoint.replace('{contactId}', '{fake}') }, context, [], issues), false);
  assert.match(issues.join(' '), /rota divergente/i);
});

test('Campos relevantes continua no escopo da resposta', () => {
  const base = { ...verifiedArticle, body: `${verifiedArticle.body}\n\n## Campos relevantes\nO campo name aparece na resposta.` };
  assert.equal(validateGroundedOutput(base, verifiedContext, []), true);
  const issues = [];
  assert.equal(validateGroundedOutput({ ...base, body: base.body.replace('campo name aparece', 'campo page aparece') }, verifiedContext, [], issues), false);
  assert.match(issues.join(' '), /campo inexistente: page/i);
});

test('responseFields null rejeita até JSON de resposta vazio', () => {
  const issues = [];
  const changed = { ...article, body: `${article.body}\n\n## Resposta\n\`\`\`json\n{}\n\`\`\`` };
  assert.equal(validateGroundedOutput(changed, context, [], issues), false);
  assert.match(issues.join(' '), /campos de resposta não verificáveis/i);
});
