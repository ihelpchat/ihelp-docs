import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints, collectCsharpErrors } from '../lib/csharp-endpoints.mjs';
import { traceCsharpCalls } from '../lib/csharp-call-chain.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const file = 'Controllers/ContactsController.cs';
const actions = [
  `[HttpGet("by-name/{name}")] public IActionResult Details(string name) { try { _service.FindByName(name); return Ok(); } catch (Exception ex) { return BadRequest(ResponseHttp.ToReturn(ex.Message)); } }`,
  `[HttpGet("by-id/{id}")] public IActionResult Details(int id) { try { _service.FindById(id); return Ok(); } catch (Exception ex) { return BadRequest(ResponseHttp.ToReturn(ex.Message)); } }`,
];
const service = 'public class ContactsService : IContactsService { public void FindByName(string name) { throw new Exception("wrong"); } public void FindById(int id) { throw new Exception("right"); } }';
for (const order of [actions, [...actions].reverse()]) {
  test(`action por identidade completa, ordem ${order[0].includes('by-name') ? 'nome-id' : 'id-nome'}`, () => {
    const source = `[Authorize][Route("api/v2/contacts")] public class ContactsController { private readonly IContactsService _service; ${order.join(' ')} }`;
    const endpoints = readCsharpEndpoints(source, file, {});
    const sources = { [file]: source, 'Services/ContactsService.cs': service };
    for (const [route, expected, rejected] of [['by-name', 'wrong', 'right'], ['by-id', 'right', 'wrong']]) {
      const endpoint = { ...endpoints.find((item) => item.route.includes(route)), file };
      const trace = traceCsharpCalls(sources, Object.keys(sources), endpoint);
      const errors = collectCsharpErrors(source, endpoint, trace.methods);
      assert.match(JSON.stringify(errors), new RegExp(expected));
      assert.doesNotMatch(JSON.stringify(errors), new RegExp(rejected));
    }
  });
}

const onlyA = { verb: 'GET', route: '/api/v2/a', public: true, documented: true, authorization: 'authenticated', parameters: [{ name: 'onlyA', type: 'string', in: 'query' }], responseFields: [] };
const onlyB = { verb: 'GET', route: '/api/v2/b', public: true, documented: true, authorization: 'authenticated', parameters: [{ name: 'onlyB', type: 'string', in: 'query' }], responseFields: [] };
const unit = (text, refs) => ({ text, citations: [], ...(refs ? { refs } : {}) });
const base = { status: 'ready', summary: [unit('Use onlyA e onlyB nas respectivas consultas.')], questions: [], articles: [
  { path: 'api/teste/a', endpoint: 'GET /a', title: 'Página A', description: unit('Consulta os registros disponíveis na primeira página desta referência pública.'), intro: unit('Use onlyA para filtrar.'), notas: [unit('Use onlyB para filtrar.')], responseDescriptions: [], parameterDescriptions: [{ name: 'onlyA', description: unit('Filtro da consulta A.') }] },
  { path: 'api/teste/b', endpoint: 'GET /b', title: 'Página B', description: unit('Consulta os registros disponíveis na segunda página desta referência pública.'), intro: unit('Use onlyB para filtrar.'), notas: [], responseDescriptions: [], parameterDescriptions: [{ name: 'onlyB', description: unit('Filtro da consulta B.') }] },
] };
async function replay(change) {
  const output = structuredClone(base); change?.(output);
  return generateContentPackage(process.cwd(), { module: 'api', topic: 'Teste' }, { productContext: {
    groundingRequired: false, matches: [], code: [], endpoints: [onlyA, onlyB], apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param'] }],
  }, plan: { status: 'ready' }, client: { responses: { create: async () => ({ output_text: JSON.stringify(output), model: 'fixture' }) } } });
}
test('nome técnico de outro endpoint sem refs é recusado', async () => {
  const result = await replay();
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /nome de outro endpoint sem referência: onlyB/u);
});
test('refs válido autoriza referência cruzada e renderiza link', async () => {
  const result = await replay((output) => { output.articles[0].notas[0].refs = [{ name: 'onlyB', endpoint: 'GET /b' }]; });
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.articles[0].body, /\[Página B\]\(\/api\/teste\/b\)/u);
});
test('refs para endpoint sem o nome é recusado', async () => {
  const result = await replay((output) => { output.articles[0].notas[0].refs = [{ name: 'onlyB', endpoint: 'GET /a' }]; });
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /referência inválida: onlyB/u);
});
test('summary do pacote mantém escopo global', async () => {
  const result = await replay((output) => { output.articles[0].notas = []; });
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.summary, /onlyA e onlyB/u);
});
