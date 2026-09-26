import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { mkdtemp, mkdir, writeFile, rm, realpath, cp } from 'node:fs/promises';
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
test('leitor extrai os três endpoints, query DTO e evidência de linha', () => {
  assert.deepEqual(endpoints.map(({ verb, route }) => [verb, route]), [
    ['GET', '/api/v2/contacts'],
    ['GET', '/api/v2/contacts/details/{IdRef}'],
    ['GET', '/api/v2/contactTags/getContactsTagByContactId/{contactId}'],
  ]);
  assert.deepEqual(endpoints[0].parameters.filter(({ in: location }) => location === 'query').map(({ name }) => name), ['searchData', 'page', 'limit']);
  assert.equal(endpoints[0].policy, 'authenticated');
  assert.match(endpoints[0].source, /ContactsController\.cs:6/);
});

test('leitor inclui campos de DTO de resposta resolvível', () => {
  const source = `[Route("api/v{version:apiVersion}/contacts")][ApiVersion("2")]
public class ContactsController { [HttpGet("details/{id}")]
public Task<ActionResult<ContactResponse>> Get(int id) { return null; } }`;
  const result = readCsharpEndpoints(source, 'Controllers/ContactsController.cs', { dtoSources: [
    { file: 'Dto/ContactResponse.cs', source: 'public class ContactResponse { public string Nome { get; set; } }' },
  ] });
  assert.deepEqual(result[0].responseFields.map(({ name, type }) => [name, type]), [['nome', 'string']]);
});
test('contexto local indexa fatos e mantém controller sem página privado', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'api-facts-test-'));
  const backend = join(root, 'back');
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  try {
    await mkdir(join(backend, 'Comzada.Application/Controllers/V2'), { recursive: true });
    await mkdir(join(backend, 'Comzada.Domain/EntitiesV2/Contato'), { recursive: true });
    await writeFile(join(backend, 'Comzada.Application/Controllers/V2/ContactsController.cs'), contacts);
    await writeFile(join(backend, 'Comzada.Application/Controllers/V2/ContactsTagController.cs'), tags);
    await writeFile(join(backend, 'Comzada.Domain/EntitiesV2/Contato/Filters.cs'), dto);
    execFileSync('git', ['init', '-q', backend]);
    execFileSync('git', ['-C', backend, 'add', '.']);
    execFileSync('git', ['-C', backend, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    await mkdir(join(root, 'architecture'), { recursive: true });
    await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: [] }));
    await writeFile(join(root, 'architecture/coverage-matrix.json'), '[]');
    await mkdir(join(root, 'content/docs/api/contatos'), { recursive: true });
    await writeFile(join(root, 'content/docs/api/contatos/buscar.mdx'), '---\nsource: api\ncontentType: referencia\nmethod: GET\nendpoint: /contacts\n---\n\n## Parâmetros\n');
    process.env.BACKEND_LOCAL_CHECKOUT = backend;
    const found = await getIhelpContext(root, 'API de Contatos', 'api', { requireLocal: true, repositoryIds: ['backend'], cache: false });
    assert.equal(found.endpoints.find((item) => item.route === '/api/v2/contacts')?.public, true);
    assert.equal(found.endpoints.find((item) => item.route.includes('getContactsTagByContactId'))?.public, false);
    assert.deepEqual(found.endpoints.find((item) => item.route === '/api/v2/contacts')?.parameters.filter((item) => item.in === 'query').map((item) => item.name), ['searchData', 'page', 'limit']);
    const copy = join(root, 'copy');
    await cp(join(root, 'architecture'), join(copy, 'architecture'), { recursive: true });
    const removed = await getIhelpContext(copy, 'API de Contatos', 'api', { requireLocal: true, repositoryIds: ['backend'], publicReferenceRoot: root });
    assert.equal(removed.endpoints.find((item) => item.route === '/api/v2/contacts')?.public, true);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
