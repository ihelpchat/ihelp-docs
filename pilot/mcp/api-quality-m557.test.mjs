import { apiProseFixture } from './api-prose-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { renderApiReference } from './api-reference-render.mjs';
import { generateContentPackage } from './content-ai-service.mjs';
import * as productContext from './product-context-service.mjs';
const selectApiStyleExamples = productContext.selectApiStyleExamples ?? (async () => []);

const controller = `[Route("api/v2/contacts")]
public class ContactsController {
 private readonly IContactsService _service;
 [HttpGet("{letter?}")]
 public IActionResult List(string letter) { var values = await _service.List(); return Ok(ResponseHttp.ToReturn(values)); }
 [HttpGet("details/{IdRef}")]
 public IActionResult Detail(string idRef) { return Ok(); }
}`;
const service = `public interface IContactsService { Task<List<ContactDto>> List(); }`;
const dto = `public class ContactDto {
 public string Nome { get; set; }
 public int Id { get; set; }
}`;
const parsed = () => readCsharpEndpoints(controller, 'Controllers/ContactsController.cs', {
  dtoSources: [{ file: 'Dto/ContactDto.cs', source: dto }],
  serviceSources: [{ file: 'Services/IContactsService.cs', source: service },
    { file: 'Repositories/ContactsRepository.cs', source: 'public class ContactsRepository { public Task<List<OtherDto>> List() { return null; } }' }],
});

test('retorno do serviço prova campos públicos e envelope de lista', () => {
  const [endpoint] = parsed();
  assert.ok(endpoint.responseFields, 'campos de resposta não verificáveis');
  assert.deepEqual(endpoint.responseFields.map(({ name, type, source }) => [name, type, source]), [
    ['nome', 'string', 'Dto/ContactDto.cs:2'], ['id', 'int', 'Dto/ContactDto.cs:3'],
  ]);
  assert.deepEqual(endpoint.responseFields.map((field) => field.path), ['dados[].nome', 'dados[].id']);
  assert.equal(endpoint.responseEnvelope, 'dados');
  assert.equal(endpoint.responseList, true);
  const page = renderApiReference(endpoint, [], { components: ['Fields', 'Field', 'Response'], sections: ['Resposta'] });
  assert.match(page.body, /name="dados\[\]\.nome"/u);
  assert.match(page.body, /## Resposta/u);
  assert.match(page.body, /```json/u);
  assert.doesNotMatch(page.pending.join('; '), /exemplo sintético aguardando a M5.56/u);
  assert.doesNotMatch(page.body, /Gian|5517936189969/u);
});

test('DTO extrai propriedades diretas e um nível do DTO aninhado', () => {
  const source = `public class ContactDto {
 public int Id { get; set; }
 public string Nome { get; set; }
 public List<CustomDto> Campos { get; set; }
 public class Nested { public int Hidden { get; set; } }
}
public class CustomDto { public int Id { get; set; } public string Valor { get; set; } }`;
  const [endpoint] = readCsharpEndpoints(controller, 'Controllers/ContactsController.cs', {
    dtoSources: [{ file: 'Dto/ContactDto.cs', source }],
    serviceSources: [{ file: 'Services/IContactsService.cs', source: service }],
  });
  assert.deepEqual(endpoint.responseFields.map(({ name, type }) => [name, type]), [
    ['id', 'int'], ['nome', 'string'], ['campos', 'List<CustomDto>'],
    ['id', 'int'], ['valor', 'string'],
  ]);
  assert.deepEqual(endpoint.responseFields.map((field) => field.path), [
    'dados[].id', 'dados[].nome', 'dados[].campos', 'dados[].campos[].id', 'dados[].campos[].valor',
  ]);
  assert.doesNotMatch(JSON.stringify(endpoint.responseFields), /hidden/u);
});

test('DTO com BOM conserva linha real da primeira propriedade e das seguintes', () => {
  const source = '\uFEFFusing System;\nnamespace Demo {\npublic class ContactDto {\n public int Id { get; set; }\n public string Nome { get; set; }\n public string IdRef { get; set; }\n}\n}';
  const [endpoint] = readCsharpEndpoints(controller, 'Controllers/ContactsController.cs', {
    dtoSources: [{ file: 'Dto/ContactDto.cs', source }],
    serviceSources: [{ file: 'Services/IContactsService.cs', source: service }],
  });
  assert.deepEqual(endpoint.responseFields.map((field) => field.source), [
    'Dto/ContactDto.cs:4', 'Dto/ContactDto.cs:5', 'Dto/ContactDto.cs:6',
  ]);
});

test('sem retorno declarado conserva pendência textual', () => {
  const [endpoint] = readCsharpEndpoints(controller, 'Controllers/ContactsController.cs', {
    dtoSources: [{ file: 'Dto/ContactDto.cs', source: dto }],
    serviceSources: [{ file: 'Services/IContactsService.cs', source: service.replace('Task<List<ContactDto>>', 'object') }],
  });
  assert.equal(endpoint.responseFields, null);
  assert.match(endpoint.pending.join('; '), /campos de resposta não verificáveis/u);
});

test('rota citada sem opcional omite parâmetro e placeholder usa nome do método', () => {
  const [list, detail] = parsed();
  const page = renderApiReference(list, [], { frontmatter: { endpoint: '/contacts' }, components: ['Params', 'Param'] });
  assert.equal(page.endpoint, '/contacts');
  assert.doesNotMatch(page.body, /name="letter"/u);
  const full = renderApiReference(list, [], { frontmatter: { endpoint: '/contacts/{letter}' }, components: ['Params', 'Param'] });
  assert.match(full.body, /name="letter"[^>]*>route \(string\), opcional/u);
  const id = renderApiReference(detail, [], { components: ['Params', 'Param'] });
  assert.equal(id.endpoint, '/contacts/details/{idRef}');
});

test('opcional omitido tem motivo textual quando página insiste no parâmetro', () => {
  const [list] = parsed();
  const result = renderApiReference(list, [], { frontmatter: { endpoint: '/contacts' }, paramNames: ['letter'], components: ['Params', 'Param'] });
  assert.match(result.pending.join('; '), /parâmetro opcional omitido da rota citada: letter/u);
});

test('descrição da IA usa campo factual e ausência registra pendência', async () => {
  const endpoint = { ...parsed()[0], public: true, documented: true, authorization: 'authenticated' };
  const article = { path: 'api/contatos/listar', endpoint: 'GET /contacts/{letter}', title: 'Listar contatos',
    description: 'Lista os contatos disponíveis para consulta na referência pública.', intro: 'Consulte os contatos disponíveis.', notas: [], grounding: [],
    responseDescriptions: [{ name: 'dados[].nome', description: 'Nome do contato.', grounding: [] }] };
  const context = { groundingRequired: false, matches: [], code: [], endpoints: [endpoint],
    apiExamples: [{ path: article.path, frontmatter: { method: 'GET', endpoint: '/contacts' },
      components: ['Params', 'Param', 'Fields', 'Field'], sections: ['Resposta'], paramNames: ['letter'] }] };
  const result = await generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos' }, {
    productContext: context, plan: { status: 'ready' },
    client: { responses: { create: async () => ({ output_text: JSON.stringify(apiProseFixture({ status: 'ready', summary: 'Contatos.',
      questions: [], articles: [article], grounding: [] })), model: 'synthetic' }) } },
  });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
  assert.match(result.articles[0].body, /texto — Nome do contato\./u);
  assert.match(result.pending.join('; '), /descrição de resposta sem fonte: dados\[\]\.id/u);
});

test('duas descrições do mesmo caminho são recusadas', async () => {
  const endpoint = { ...parsed()[0], public: true, documented: true, authorization: 'authenticated' };
  const item = { name: 'dados[].id', description: { text: 'Identificador do contato.', citations: [] } };
  let schemaPaths;
  const generate = async (responseDescriptions) => generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos' }, {
    productContext: { groundingRequired: false, matches: [], code: [], endpoints: [endpoint],
      apiExamples: [{ path: 'api/contatos/listar', frontmatter: { method: 'GET', endpoint: '/contacts' },
        components: ['Fields', 'Field'], sections: ['Resposta'] }] },
    plan: { status: 'ready' },
    client: { responses: { create: async (payload) => { schemaPaths = payload.text.format.schema.properties.articles.items.properties.responseDescriptions.items.properties.name.enum;
      return { output_text: JSON.stringify({ status: 'ready', summary: [{ text: 'Contatos.', citations: [] }], questions: [],
      articles: [{ path: 'api/contatos/listar', endpoint: 'GET /contacts/{letter}', title: 'Listar contatos',
        description: { text: 'Lista os contatos disponíveis para consulta na referência pública.', citations: [] }, intro: { text: 'Consulte contatos.', citations: [] }, notas: [], responseHeaders: [],
        responseDescriptions }] }), model: 'synthetic' }; } } },
  });
  const positive = await generate([item]);
  assert.equal(positive.status, 'ready', positive.summary);
  assert.deepEqual(schemaPaths, ['dados[].nome', 'dados[].id']);
  const result = await generate([item, item]);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /descrição de campo sem fato: dados\[\]\.id/u);
});

test('few-shot escolhe três páginas por seções e notas, reagindo a edição', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm557-style-'));
  try {
    await mkdir(root, { recursive: true });
    for (const [name, sections] of [['a', 4], ['b', 3], ['c', 2], ['d', 1]])
      await writeFile(join(root, `${name}.mdx`), `---\nsource: api\nmethod: GET\nendpoint: /${name}\n---\n${'## Nota útil\nTexto.\n'.repeat(sections)}`);
    const first = await selectApiStyleExamples(root);
    assert.deepEqual(first.map((item) => item.path), ['api/a', 'api/b', 'api/c']);
    await writeFile(join(root, 'd.mdx'), `---\nsource: api\nmethod: GET\nendpoint: /d\n---\n${'## Nota útil\nTexto.\n'.repeat(5)}`);
    const second = await selectApiStyleExamples(root);
    assert.deepEqual(second.map((item) => item.path), ['api/d', 'api/a', 'api/b']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
