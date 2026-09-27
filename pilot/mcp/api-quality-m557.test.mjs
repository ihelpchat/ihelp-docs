import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { renderApiReference } from './api-reference-render.mjs';
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
  serviceSources: [{ file: 'Services/IContactsService.cs', source: service }],
});

test('retorno do serviço prova campos públicos e envelope de lista', () => {
  const [endpoint] = parsed();
  assert.ok(endpoint.responseFields, 'campos de resposta não verificáveis');
  assert.deepEqual(endpoint.responseFields.map(({ name, type, source }) => [name, type, source]), [
    ['nome', 'string', 'Dto/ContactDto.cs:2'], ['id', 'int', 'Dto/ContactDto.cs:3'],
  ]);
  assert.equal(endpoint.responseEnvelope, 'dados');
  assert.equal(endpoint.responseList, true);
  const page = renderApiReference(endpoint, [], { components: ['Fields', 'Field', 'Response'], sections: ['Resposta'] });
  assert.match(page.body, /name="dados\[\]\.nome"/u);
  assert.match(page.body, /## Resposta[\s\S]*```json/u);
  assert.doesNotMatch(page.body, /Gian|5517936189969/u);
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

test('few-shot escolhe três páginas por seções e notas, reagindo a edição', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm557-style-'));
  try {
    await mkdir(join(root, 'api'), { recursive: true });
    for (const [name, sections] of [['a', 4], ['b', 3], ['c', 2], ['d', 1]])
      await writeFile(join(root, 'api', `${name}.mdx`), `---\nsource: api\nmethod: GET\nendpoint: /${name}\n---\n${'## Nota útil\nTexto.\n'.repeat(sections)}`);
    const first = await selectApiStyleExamples(root);
    assert.deepEqual(first.map((item) => item.path), ['api/a', 'api/b', 'api/c']);
    await writeFile(join(root, 'api/d.mdx'), `---\nsource: api\nmethod: GET\nendpoint: /d\n---\n${'## Nota útil\nTexto.\n'.repeat(5)}`);
    const second = await selectApiStyleExamples(root);
    assert.deepEqual(second.map((item) => item.path), ['api/d', 'api/a', 'api/b']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
