import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const dtoSources = ['ContactDetailsDto', 'OtherDto'].map((name) => ({
  file: `Dto/${name}.cs`, source: `public class ${name} { public string Name { get; set; } }`,
}));
const controller = (argument, signature = 'string idRef', prefix = '') => `[Route("api/v2/contacts")]
public class ContactsController {
 private readonly IContactsService _service;
 [HttpGet("details/{idRef}")]
 public async Task<IActionResult> Details(${signature}) {
   ${prefix}
   var values = await _service.GetContactDetailsAsync(${argument});
   return Ok(ResponseHttp.ToReturn(values));
 }
}`;
const service = (signatures) => `public class ContactsService : IContactsService {
${signatures.map(([type, args]) => `public Task<${type}> GetContactDetailsAsync(${args}) { return null; }`).join('\n')}
}`;
const read = (action, signatures) => readCsharpEndpoints(action, 'Controllers/ContactsController.cs', {
  dtoSources, serviceSources: [{ file: 'Services/ContactsService.cs', source: service(signatures) }],
})[0];
const scalar = ['ContactDetailsDto', 'string idRef'];
const batch = ['List<OtherDto>', 'List<string> idRefs'];

test('sobrecarga por quantidade de argumentos seleciona o retorno da chamada', () => {
  const result = read(controller('idRef'), [scalar, ['OtherDto', 'string idRef, int businessId']]);
  assert.equal(result.responseType, 'ContactDetailsDto');
  assert.deepEqual(result.responseFields.map((field) => field.path), ['dados.name']);
});

test('sobrecarga por tipo simples distingue string de List', () => {
  const result = read(controller('idRef'), [batch, scalar]);
  assert.equal(result.responseType, 'ContactDetailsDto');
  assert.deepEqual(result.responseFields.map((field) => field.path), ['dados.name']);
  const local = read(controller('ids', 'string idRef', 'List<string> ids = new List<string>();'), [scalar, batch]);
  assert.equal(local.responseType, 'OtherDto');
  assert.deepEqual(local.responseFields.map((field) => field.path), ['dados[].name']);
});

test('retornos idênticos nas candidatas resolvem o mesmo DTO', () => {
  const result = read(controller('GetId()'), [scalar, ['ContactDetailsDto', 'int id']]);
  assert.equal(result.responseType, 'ContactDetailsDto');
  assert.equal(result.responseFields.length, 1);
});

test('retornos diferentes com argumento desconhecido preservam pendência', () => {
  const result = read(controller('GetId()'), [scalar, ['OtherDto', 'int id']]);
  assert.equal(result.responseFields, null);
  assert.match(result.pending.join('; '), /campos de resposta não verificáveis/u);
});

const endpoint = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  authorization: 'authenticated', responseFields: [],
  parameters: [{ name: 'linkedToMe', type: 'bool', in: 'query' },
    { name: 'page', type: 'int', in: 'query' }, { name: 'departmentIds', type: 'List<int>', in: 'query' }] };
const unit = (text) => ({ text, citations: [] });
const article = () => ({ path: 'api/contatos/listar', endpoint: 'GET /contacts', title: 'Listar contatos',
  description: unit('Lista os contatos disponíveis para consulta na API pública.'), intro: unit('Consulte os contatos disponíveis.'),
  notas: [unit('departmentIds e page aceitam filtros na consulta; os departamentos permanecem opcionais.')],
  responseDescriptions: [], parameterDescriptions: [
    { name: 'linkedToMe', description: unit('Restringe aos contatos vinculados ao usuário autenticado.') },
    { name: 'page', description: unit('Escolhe a página da lista.') },
    { name: 'departmentIds', description: unit('Restringe aos departamentos informados.') },
  ] });
async function generate(output) {
  let calls = 0, retry = '';
  const result = await generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos', confirmations: ['GET /contacts'] }, {
    productContext: { groundingRequired: false, matches: [], code: [], endpoints: [endpoint],
      apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param', 'Fields', 'Field'] }] },
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      calls++;
      if (calls === 2) retry = payload.input.at(-1).content;
      return { output_text: JSON.stringify(output), model: 'fixture' };
    } } },
  });
  return { result, calls, retry };
}
const packageOf = (value) => ({ status: 'ready', summary: [unit('Referência de contatos.')], questions: [], articles: [value] });

test('parâmetro sem descrição entra na tentativa única e depois vira pendência', async () => {
  const positive = await generate(packageOf(article()));
  assert.equal(positive.result.status, 'ready');
  assert.equal(positive.calls, 1);
  const missing = article();
  missing.parameterDescriptions = missing.parameterDescriptions.filter((item) => item.name !== 'linkedToMe');
  const negative = await generate(packageOf(missing));
  assert.equal(negative.calls, 2);
  assert.match(negative.retry, /parâmetro sem descrição: linkedToMe/u);
  assert.equal(negative.result.status, 'ready');
  assert.match(negative.result.pending.join('; '), /parâmetro sem descrição: linkedToMe/u);
});

test('renderizador põe crase somente nos nomes técnicos dos fatos', async () => {
  const generated = await generate(packageOf(article()));
  assert.equal(generated.result.status, 'ready', generated.result.summary);
  assert.match(generated.result.articles[0].body, /`departmentIds` e `page` aceitam filtros/u);
  assert.match(generated.result.articles[0].body, /os departamentos permanecem opcionais/u);
  assert.doesNotMatch(generated.result.articles[0].body, /`departamentos`/u);
});
