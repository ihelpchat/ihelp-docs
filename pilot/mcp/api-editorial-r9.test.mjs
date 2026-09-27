import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { renderApiReference } from './api-reference-render.mjs';
import { valueFor, syntheticResponseExample } from './api-synthetic-example.mjs';
import { securityReview } from './security-review.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const style = { sections: ['Parâmetros', 'Exemplo', 'Resposta'],
  components: ['Params', 'Param', 'CodeTabs', 'Fields', 'Field'], languages: ['bash', 'js', 'python', 'http'] };
const list = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  authorization: 'authenticated', responseEnvelope: 'dados', responseList: true,
  responseFields: [{ name: 'email', type: 'string' }, { name: 'numero', type: 'string' },
    { name: 'dataCriacao', type: 'string' }, { name: 'nome', type: 'string' }, { name: 'idRef', type: 'string' },
    { name: 'atualizadoEm', type: 'DateTime' }],
  parameters: [{ name: 'searchData', type: 'string', in: 'query', default: '' },
    { name: 'page', type: 'int', in: 'query', default: 1 }, { name: 'limit', type: 'int', in: 'query', default: 20 },
    { name: 'export', type: 'bool', in: 'query', default: false },
    { name: 'departmentIds', type: 'List<int>', in: 'query', default: [] }] };

test('valor sintético usa significado, tipo e padrão e passa revisão de segurança', () => {
  const expected = { email: 'pessoa@exemplo.com', numero: '5500000000000', dataCriacao: '27/09/2026',
    nome: 'Maria Exemplo', idRef: 'id-exemplo-1', atualizadoEm: '2026-09-27T00:00:00Z' };
  const actual = syntheticResponseExample(list).dados[0];
  for (const [name, value] of Object.entries(expected)) assert.equal(actual[name], value, name);
  assert.equal(valueFor(list.parameters[2]), '20');
  assert.deepEqual(valueFor(list.parameters[4]), ['1', '2']);
  const body = renderApiReference(list, [style], style).body;
  assert.deepEqual(securityReview({ path: 'api/contatos/listar', method: 'GET', endpoint: '/contacts', body },
    { facts: list }).blocks, []);
  const oneChange = { ...list, responseFields: list.responseFields.map((field) =>
    field.name === 'email' ? { ...field, name: 'unknown' } : field) };
  assert.notEqual(syntheticResponseExample(oneChange).dados[0].unknown, expected.email);
});

test('requisição mostra só busca e paginação, preservando todos os Params', () => {
  const body = renderApiReference(list, [style], style).body;
  assert.deepEqual([...body.matchAll(/<Param name="([^"]+)"/gu)].map((match) => match[1]),
    list.parameters.map((item) => item.name));
  const urls = [...body.matchAll(/https:\/\/apiv3\.ihelpchat\.com\/api\/v2\/contacts\?[^\s'"`]+/gu)].map((match) => match[0]);
  assert.ok(urls.length >= 4);
  for (const url of urls) {
    const params = new URL(url).searchParams;
    assert.deepEqual([...params.keys()], ['searchData', 'page', 'limit']);
    assert.equal(params.get('limit'), '20');
    assert.equal(params.get('searchData'), 'exemplo');
  }
});

test('List<int> é array descrito como lista de números; padrão vazio não aparece', () => {
  const body = renderApiReference(list, [style], style).body;
  assert.match(body, /<Param name="departmentIds" type="array">[^<]*lista de números/u);
  assert.doesNotMatch(body, /Listint|padrão:\s*<\/Param>/u);
  const withoutDefault = { ...list, parameters: [{ name: 'searchData', type: 'string', in: 'query' }] };
  assert.doesNotMatch(renderApiReference(withoutDefault, [style], style).body, /padrão:/u);
});

const unit = (text) => ({ text, citations: [] });
const prose = (parameterDescriptions) => ({ status: 'ready', summary: [unit('Referência de contatos.')], questions: [],
  articles: [{ path: 'api/contatos/listar', endpoint: 'GET /contacts', title: 'Listar contatos',
    description: unit('Lista contatos disponíveis para consulta.'), intro: unit('Consulte os contatos disponíveis.'),
    notas: [], responseDescriptions: [], parameterDescriptions }] });
const generate = (parameterDescriptions) => generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos' }, {
  productContext: { groundingRequired: false, matches: [], code: [], endpoints: [list], apiExamples: [style] },
  plan: { status: 'ready' }, client: { responses: { create: async () =>
    ({ output_text: JSON.stringify(prose(parameterDescriptions)), model: 'fixture' }) } },
});

test('descrição factual vai dentro do Param e nome fora dos fatos é recusado', async () => {
  const positive = await generate([{ name: 'limit', description: unit('Limita a quantidade de contatos por página.') }]);
  assert.equal(positive.status, 'ready', positive.summary);
  assert.match(positive.articles[0].body, /<Param name="limit"[^>]*>[^<]*Limita a quantidade de contatos por página\.<\/Param>/u);
  const negative = await generate([{ name: 'limitx', description: unit('Limita a quantidade de contatos por página.') }]);
  assert.equal(negative.status, 'needs_information');
  assert.match(negative.summary, /limitx/u);
});

test('Node e Python leem dados somente quando existe envelope', () => {
  const body = renderApiReference(list, [style], style).body;
  assert.match(body, /const \{ dados \} = await res\.json\(\);/u);
  assert.match(body, /r\.json\(\)\["dados"\]/u);
  const direct = { ...list, responseEnvelope: null };
  const directBody = renderApiReference(direct, [style], style).body;
  assert.doesNotMatch(directBody, /const \{ dados \}|r\.json\(\)\["dados"\]/u);
});

test('cadeia da tag resolve IEnumerable<ContactsTagDTO> sem envelope', () => {
  const controller = `[Route("api/v2/contactTags")]
public class ContactsTagController {
 private readonly IContactsTagService _contactsTagService;
 [HttpGet("getContactsTagByContactId/{contactId}")]
 public async Task<IActionResult> GetContactsTagByContactId([FromRoute] int contactId) {
   var values = await _contactsTagService.GetContactsTagByContactId(contactId, GetBusinessId());
   return Ok(values);
 }
}`;
  const service = `public class ContactsTagService { public async Task<IEnumerable<ContactsTagDTO>> GetContactsTagByContactId(int contactId, int businessId) { return null; } }`;
  const dto = `public class ContactsTagDTO {\n public int Id { get; set; }\n public int ContatoId { get; set; }\n public string TagName { get; set; }\n}`;
  const parse = (source) => readCsharpEndpoints(controller, 'Controllers/ContactsTagController.cs', {
    serviceSources: [{ file: 'Services/ContactsTagService.cs', source },
      { file: 'Interfaces/IContactsTagService.cs', source: service.replace('class ContactsTagService', 'interface IContactsTagService') }],
    dtoSources: [{ file: 'Dto/ContactsTagDTO.cs', source: dto }],
  })[0];
  const positive = parse(service);
  assert.deepEqual(positive.responseFields.map((field) => field.path), ['[].id', '[].contatoId', '[].tagName']);
  assert.equal(positive.responseEnvelope, null);
  assert.equal(positive.responseList, true);
  const negative = parse(service.replaceAll('ContactsTagDTO', 'UnknownDTO'));
  assert.equal(negative.responseFields, null);
});
