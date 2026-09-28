import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints, collectCsharpErrors } from '../lib/csharp-endpoints.mjs';
import { traceCsharpCalls } from '../lib/csharp-call-chain.mjs';

const controllerPath = 'Controllers/ContactsController.cs';
const servicePath = 'Services/ContactsService.cs';
const repositoryPath = 'Repository/ContactsRepository.cs';
const dtoSources = [{ file: 'Dto/ContactDto.cs', source: 'public class ContactDto { public string Name { get; set; } }' }];
const controller = (argument, helper = '') => `[Authorize][Route("api/v2/contacts")]
public class ContactsController {
 private readonly IContactsService _service;
 [HttpGet("details/{idRef}")]
 public async Task<IActionResult> Details(string idRef) {
   try {
     var values = await _service.Find(${argument});
     return Ok(ResponseHttp.ToReturn(values));
   } catch (Exception ex) { return BadRequest(ResponseHttp.ToReturn(ex.Message)); }
 }
 ${helper}
}`;
const service = `public class ContactsService : IContactsService {
 private readonly IContactsRepository _repository;
 public Task<ContactDto> Find(int key) {
   throw new Exception("Integer-only failure");
   return _repository.Find(1);
 }
 public Task<ContactDto> Find(string key) {
   throw new Exception("Actual string failure");
   return _repository.Find(key);
 }
}`;
const repository = `public class ContactsRepository : IContactsRepository {
 public Task<ContactDto> Find(int key) { throw new Exception("Integer repository failure"); }
 public Task<ContactDto> Find(string key) { throw new Exception("String repository failure"); }
}`;

function analyze(argument, helper = '') {
  const source = controller(argument, helper);
  const sources = { [controllerPath]: source, [servicePath]: service, [repositoryPath]: repository };
  const endpoint = readCsharpEndpoints(source, controllerPath, {
    dtoSources, serviceSources: [{ file: servicePath, source: service }],
  })[0];
  endpoint.file = controllerPath;
  const trace = traceCsharpCalls(sources, Object.keys(sources), endpoint);
  return { endpoint, trace, errors: collectCsharpErrors(source, endpoint, trace.methods) };
}

test('tipo desconhecido conserva DTO comum sem publicar corpos de sobrecargas ou cadeia', () => {
  const { endpoint, trace, errors } = analyze('UnknownKey()');
  assert.deepEqual(endpoint.responseFields.map((field) => field.path), ['dados.name']);
  assert.deepEqual(trace.methods, []);
  assert.match(trace.pending.join('; '), /sobrecarga ambígua: ContactsService\.Find: erros e cadeia não verificados/u);
  assert.doesNotMatch(JSON.stringify(errors), /Integer-only failure|Actual string failure|repository failure/iu);
});

test('retorno declarado de método local seleciona somente Find(string) e sua cadeia', () => {
  const { trace, errors } = analyze('GetKey()', 'private string GetKey() { return "abc"; }');
  assert.deepEqual(trace.methods.map((method) => `${method.path}:${method.method}`), [
    `${servicePath}:Find`, `${repositoryPath}:Find`,
  ]);
  assert.match(JSON.stringify(errors), /Actual string failure/u);
  assert.doesNotMatch(JSON.stringify(errors), /Integer-only failure|Integer repository failure/u);
  assert.doesNotMatch(trace.pending.join('; '), /sobrecarga ambígua/u);
});
