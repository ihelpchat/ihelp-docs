import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { validateGroundedOutput, generateContentPackage } from './content-ai-service.mjs';

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
