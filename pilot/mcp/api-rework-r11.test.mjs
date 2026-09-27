import test from 'node:test';
import assert from 'node:assert/strict';
import * as csharp from '../lib/csharp-endpoints.mjs';
import * as content from './content-ai-service.mjs';
import { renderApiReference } from './api-reference-render.mjs';
const { readCsharpEndpoints } = csharp;
const collectCsharpErrors = (...args) => csharp.collectCsharpErrors?.(...args) ?? [];
const classifyApiQuestions = (...args) => content.classifyApiQuestions?.(...args) ?? { blocking: args[0], pending: [] };

const controller = `[Authorize][Route("api/v2/contacts")]
public class ContactsController {
 private readonly IContactsService _service;
 [HttpGet("details/{idRef}")]
 public async Task<IActionResult> Details(string idRef) {
   try { var values = await _service.GetContactDetailsAsync(idRef);
     return Ok(ResponseHttp.ToReturn(values)); }
   catch (Exception ex) { return BadRequest(ResponseHttp.ToReturn(ex.Message)); }
 }
}`;
const dtoSources = [
  { file: 'Dto/ContactDetailsDto.cs', source: `public class ContactDetailsDto {
    public string Name { get; set; }
    public List<ResponsibleDto> ResponsibleUsers { get; set; }
    public MissingDto UnknownItems { get; set; }
  }` },
  { file: 'Dto/ResponsibleDto.cs', source: `public class ResponsibleDto {
    public string Nome { get; set; }
    public int Id { get; set; }
  }` },
];
const endpoint = () => readCsharpEndpoints(controller, 'Controllers/ContactsController.cs', { dtoSources,
  serviceSources: [{ file: 'Services/ContactsService.cs', source: 'public class ContactsService { public Task<ContactDetailsDto> GetContactDetailsAsync(string idRef) { return null; } }' }] })[0];

test('pergunta secundária vira pendência e o plano segue; parâmetro ausente bloqueia', () => {
  const facts = [endpoint()];
  const questions = [
    'Quais campos e tipos compõem cada item de responsibleUsers na resposta de detalhes?',
    'Quais erros/status HTTP devem ser documentados para o endpoint?',
  ];
  const secondary = classifyApiQuestions(questions, facts);
  assert.deepEqual(secondary.blocking, []);
  assert.deepEqual(secondary.pending, questions);
  const missing = classifyApiQuestions(['Qual o tipo do parâmetro cursor ausente dos fatos?'], facts);
  assert.deepEqual(missing.blocking, ['Qual o tipo do parâmetro cursor ausente dos fatos?']);
});

test('catch BadRequest e throw alcançado geram erros; throw não alcançado fica fora', () => {
  const found = endpoint();
  const reached = [{ excerpt: 'public Task<ContactDetailsDto> GetContactDetailsAsync(string idRef) { throw new Exception("Contato não encontrado."); }' }];
  const errors = collectCsharpErrors(controller, found, reached);
  assert.ok(errors.some((item) => item.status === 400 && item.message === 'Contato não encontrado.'), JSON.stringify(errors));
  assert.ok(errors.some((item) => item.status === 401), JSON.stringify(errors));
  const rendered = renderApiReference({ ...found, errors }, [], {});
  assert.match(rendered.body, /## Erros comuns[\s\S]*\| HTTP \| Mensagem \| Quando \|/u);
  assert.match(rendered.body, /\| 400 \| Contato não encontrado\. \|/u);
  const unrelated = collectCsharpErrors(controller, found, [{ excerpt: 'public void Other() { throw new Exception("Outro erro."); }' }]);
  assert.doesNotMatch(JSON.stringify(unrelated), /Contato não encontrado/u);
  assert.match(JSON.stringify(unrelated), /Outro erro/u);
  const withoutCatch = collectCsharpErrors(controller.replace('BadRequest(ResponseHttp.ToReturn(ex.Message))', 'Ok()'), found, reached);
  assert.doesNotMatch(JSON.stringify(withoutCatch), /"status":400/u);
});

test('lista de DTO expande um nível e tipo desconhecido vira pendência', () => {
  const found = endpoint();
  assert.ok(found.responseFields.some((field) => field.path === 'dados.responsibleUsers[].nome'), JSON.stringify(found));
  assert.ok(found.responseFields.some((field) => field.path === 'dados.responsibleUsers[].id'), JSON.stringify(found));
  assert.ok(!found.responseFields.some((field) => field.path.includes('responsibleUsers[].other.')));
  assert.match(found.pending.join('; '), /tipo aninhado não resolvido: MissingDto/u);
});
