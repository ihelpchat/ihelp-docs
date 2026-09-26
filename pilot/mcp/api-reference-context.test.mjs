import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { planContent, generateContentPackage } from './content-ai-service.mjs';
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
    ['GET', '/api/v2/contacts/{letter}'],
    ['GET', '/api/v2/contacts/details/{IdRef}'],
    ['GET', '/api/v2/contactTags/getContactsTagByContactId/{contactId}'],
  ]);
  assert.deepEqual(endpoints[0].parameters.filter(({ in: location }) => location === 'query').map(({ name, type }) => [name, type]), [['searchData', 'string'], ['page', 'int'], ['limit', 'int']]);
  assert.equal(endpoints[0].policy, 'authenticated');
  assert.equal(endpoints[0].routeSource, 'Controllers/ContactsController.cs:3');
  assert.equal(endpoints[0].verbSource, 'Controllers/ContactsController.cs:5');
  assert.equal(endpoints[0].authorizationSource, 'Controllers/ContactsController.cs:1');
  assert.equal(endpoints[0].parameters.find(({ name }) => name === 'letter')?.source, 'Controllers/ContactsController.cs:6');
});

test('leitor remove constraints e mantém parâmetros opcionais na rota', () => {
  const source = `[ApiVersion("2")][Route("api/v{version:apiVersion}/items")]
public class ItemsController {
  [HttpGet("{id:int}")] public IActionResult ById(int id) { return null; }
  [HttpGet("guid/{id:guid?}")] public IActionResult ByGuid(Guid id) { return null; }
  [HttpGet("slug/{slug}")] public IActionResult BySlug(string slug) { return null; }
  [HttpGet("optional/{name?}")] public IActionResult ByName(string name) { return null; }
}`;
  const result = readCsharpEndpoints(source, 'Controllers/ItemsController.cs', { dtoSources: [] });
  assert.deepEqual(result.map(({ route }) => route), [
    '/api/v2/items/{id}', '/api/v2/items/guid/{id}', '/api/v2/items/slug/{slug}', '/api/v2/items/optional/{name}',
  ]);
  assert.deepEqual(result.map(({ parameters }) => parameters.map(({ name, type, in: location }) => [name, type, location])), [
    [['id', 'int', 'route']], [['id', 'Guid', 'route']], [['slug', 'string', 'route']], [['name', 'string', 'route']],
  ]);
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
test('leitor distingue resposta desconhecida de DTO vazio e resolve Ok tipado', () => {
  const source = `[Route("api/v{version:apiVersion}/contacts")][ApiVersion("2")]
public class ContactsController {
  [HttpGet("known")]
  public Task<IActionResult> Known() { ContactResponse values = new ContactResponse(); return Ok(values); }
  [HttpGet("inline")]
  public Task<IActionResult> Inline() { return Ok(new ContactResponse { Name = "x" }); }
  [HttpGet("unknown")]
  public Task<IActionResult> Unknown() { return Ok(values); }
}`;
  const result = readCsharpEndpoints(source, 'Controllers/ContactsController.cs', { dtoSources: [
    { file: 'Comzada.Domain/EntitiesV2/Contato/ContactResponse.cs', source: 'public class ContactResponse { public string Name { get; set; } }' },
  ] });
  assert.deepEqual(result[0].responseFields.map(({ name }) => name), ['name']);
  assert.deepEqual(result[1].responseFields.map(({ name }) => name), ['name']);
  assert.equal(result[2].responseFields, null);
  assert.match(result[2].pending.join(' '), /campos de resposta não verificáveis:.*unknown/i);
});

test('AllowAnonymous prevalece sobre Authorize e chega como fato ao contexto', () => {
  const source = `[Authorize][Route("api/v{version:apiVersion}/contacts")][ApiVersion("2")]
public class ContactsController {
  [AllowAnonymous][HttpGet("public")]
  public Task<IActionResult> Public() { return Ok(); }
}`;
  const [endpoint] = readCsharpEndpoints(source, 'Controllers/ContactsController.cs', { dtoSources: [] });
  assert.equal(endpoint.authorization, 'anonymous');
  assert.equal(endpoint.policy, 'anonymous');
  assert.equal(endpoint.authorizationSource, 'Controllers/ContactsController.cs:3');
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
    assert.equal(found.endpoints.find((item) => item.route === '/api/v2/contacts/{letter}')?.public, true);
    assert.equal(found.endpoints.some((item) => item.route.includes('getContactsTagByContactId')), false);
    assert.deepEqual(found.endpoints.find((item) => item.route === '/api/v2/contacts/{letter}')?.parameters.filter((item) => item.in === 'query').map((item) => [item.name, item.type]), [['searchData', 'string'], ['page', 'int'], ['limit', 'int']]);
    const copy = join(root, 'copy');
    await cp(join(root, 'architecture'), join(copy, 'architecture'), { recursive: true });
    const removed = await getIhelpContext(copy, 'API de Contatos', 'api', { requireLocal: true, repositoryIds: ['backend'], publicReferenceRoot: root });
    assert.equal(removed.endpoints.find((item) => item.route === '/api/v2/contacts/{letter}')?.public, true);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('coleta DTO de saída no checkout e impede controller privado no prompt final', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'api-output-test-'));
  const backend = join(root, 'back');
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  try {
    await mkdir(join(backend, 'Comzada.Application/Controllers/V2'), { recursive: true });
    await mkdir(join(backend, 'Comzada.Domain/EntitiesV2/Contato'), { recursive: true });
    await writeFile(join(backend, 'Comzada.Application/Controllers/V2/ContactsController.cs'), `[Authorize]\n[ApiVersion("2")]\n[Route("api/v{version:apiVersion}/contacts")]\npublic class ContactsController {\n  [AllowAnonymous][HttpGet("{id}")]\n  public Task<ActionResult<ContactResponse>> Get([FromRoute] int id) { return null; }\n}`);
    await writeFile(join(backend, 'Comzada.Application/Controllers/V2/InternalController.cs'), `[Route("api/v{version:apiVersion}/internal")]\n[ApiVersion("2")]\npublic class InternalController {\n  // contacts are visible only in the private service\n  [HttpGet("private/{id}")]\n  public Task<IActionResult> Get([FromRoute] int id) { return null; }\n}`);
    await writeFile(join(backend, 'Comzada.Domain/EntitiesV2/Contato/ContactResponse.cs'), 'public class ContactResponse {\n  public string Name { get; set; }\n}');
    execFileSync('git', ['init', '-q', backend]);
    execFileSync('git', ['-C', backend, 'add', '.']);
    execFileSync('git', ['-C', backend, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    await mkdir(join(root, 'architecture'), { recursive: true });
    await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: [] }));
    await writeFile(join(root, 'architecture/coverage-matrix.json'), '[]');
    await mkdir(join(root, 'content/docs/api/contatos'), { recursive: true });
    await writeFile(join(root, 'content/docs/api/contatos/buscar.mdx'), '---\nsource: api\ncontentType: referencia\nmethod: GET\nendpoint: /contacts/{id}\n---\n');
    process.env.BACKEND_LOCAL_CHECKOUT = backend;
    const context = await getIhelpContext(root, 'API contacts', 'api', { requireLocal: true, repositoryIds: ['backend'], cache: false });
    assert.deepEqual(context.endpoints.find((item) => item.controller === 'ContactsController')?.responseFields.map(({ name, type }) => [name, type]), [['name', 'string']]);
    const captured = [];
    await planContent(root, { topic: 'API contacts', module: 'api', description: 'Documentar contatos' }, {
      productContext: context, client: { responses: { create: async (payload) => {
        captured.push(payload.input[1].content);
        return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }), model: 'fake' };
      } } },
    });
    assert.equal(captured.length, 1);
    assert.match(captured[0], /"authorization":"anonymous"/);
    assert.doesNotMatch(captured[0], /private\/\{id\}|InternalController/);
    assert.equal(context.endpoints.some(({ public: visible }) => visible === false), false);
    assert.equal(context.matches.some(({ path }) => path.includes('InternalController')), false);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('endpoint sem página continua pendente quando outro controller é público', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'api-mixed-surface-'));
  const backend = join(root, 'back');
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  try {
    const controllers = join(backend, 'Comzada.Application/Controllers/V2');
    await mkdir(controllers, { recursive: true });
    await writeFile(join(controllers, 'ContactsController.cs'), `[ApiVersion("2")][Route("api/v{version:apiVersion}/contacts")]
public class ContactsController {
  [HttpGet("")] public Task<IActionResult> Get() { return null; }
}`);
    await writeFile(join(controllers, 'InternalContactsController.cs'), `[ApiVersion("2")][Route("api/v{version:apiVersion}/internal-contacts")]
public class InternalContactsController {
  [HttpGet("private")] public Task<IActionResult> Get() { return null; }
}`);
    execFileSync('git', ['init', '-q', backend]);
    execFileSync('git', ['-C', backend, 'add', '.']);
    execFileSync('git', ['-C', backend, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    await mkdir(join(root, 'architecture'), { recursive: true });
    await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: [] }));
    await writeFile(join(root, 'architecture/coverage-matrix.json'), '[]');
    await mkdir(join(root, 'content/docs/api/contatos'), { recursive: true });
    await writeFile(join(root, 'content/docs/api/contatos/buscar.mdx'), '---\nsource: api\ncontentType: referencia\nmethod: GET\nendpoint: /contacts\n---\n');
    process.env.BACKEND_LOCAL_CHECKOUT = backend;
    const context = await getIhelpContext(root, 'API de Contatos', 'api', { requireLocal: true, repositoryIds: ['backend'] });
    assert.deepEqual(context.endpoints.map(({ route }) => route), ['/api/v2/contacts']);
    assert.ok(context.pending.includes('endpoint não público: confirmar (GET /api/v2/internal-contacts/private)'), context.pending.join('; '));
    const prompts = [];
    const result = await planContent(root, { topic: 'API de Contatos', module: 'api' }, {
      productContext: context, client: { responses: { create: async (payload) => {
        prompts.push(JSON.stringify(payload));
        return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }), model: 'fake' };
      } } },
    });
    assert.equal(prompts.length, 1);
    assert.doesNotMatch(prompts[0], /internal-contacts|InternalContactsController/);
    assert.ok(result.pending.includes('endpoint não público: confirmar (GET /api/v2/internal-contacts/private)'), JSON.stringify(result));
    const packageResult = await generateContentPackage(root, { topic: 'API de Contatos', module: 'api' }, {
      productContext: context, plan: { ...result, status: 'ready' }, client: { responses: { create: async (payload) => {
        prompts.push(JSON.stringify(payload));
        return { output_text: JSON.stringify({ status: 'needs_information', summary: '', questions: [], articles: [], grounding: [] }), model: 'fake' };
      } } },
    });
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts[1], /internal-contacts|InternalContactsController/);
    assert.ok(packageResult.pending.includes('endpoint não público: confirmar (GET /api/v2/internal-contacts/private)'), JSON.stringify(packageResult));
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('pedido explícito libera apenas endpoint extraído no fluxo de plano e pacote', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'api-request-route-'));
  const backend = join(root, 'back');
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  try {
    const controllers = join(backend, 'Comzada.Application/Controllers/V2');
    await mkdir(controllers, { recursive: true });
    await writeFile(join(controllers, 'ContactsController.cs'), `[ApiVersion("2")][Route("api/v{version:apiVersion}/contacts")]
public class ContactsController {
  [HttpGet("details/{id}")] public IActionResult Details(int id) { return null; }
}`);
    execFileSync('git', ['init', '-q', backend]);
    execFileSync('git', ['-C', backend, 'add', '.']);
    execFileSync('git', ['-C', backend, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    await mkdir(join(root, 'architecture'), { recursive: true });
    await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: [] }));
    await writeFile(join(root, 'architecture/coverage-matrix.json'), '[]');
    process.env.BACKEND_LOCAL_CHECKOUT = backend;
    const prompts = [];
    const client = { responses: { create: async (payload) => {
      prompts.push(payload.input[1].content);
      return { output_text: JSON.stringify({ status: 'needs_information', summary: '', guidance: '', questions: [], risks: [], suggestedActions: [], articles: [], grounding: [] }), model: 'fake' };
    } } };
    const options = { client, contextOptions: { repositoryIds: ['backend'], cache: false } };
    const full = { topic: 'API de Contatos', module: 'api', description: 'Documentar GET /api/v2/contacts/details/{id}' };
    const planned = await planContent(root, full, options);
    assert.equal(prompts.length, 1, JSON.stringify(planned));
    assert.match(prompts[0], /"route":"\/api\/v2\/contacts\/details\/\{id\}"/);
    assert.deepEqual(planned.pending, ['campos de resposta não verificáveis: GET /api/v2/contacts/details/{id}']);
    const short = { topic: 'API de Contatos', module: 'api', description: 'Referência de contatos', details: 'GET /contacts/details/{id}' };
    const generated = await generateContentPackage(root, short, { ...options, plan: { status: 'ready' } });
    assert.equal(prompts.length, 2, JSON.stringify(generated));
    assert.match(prompts[1], /"route":"\/api\/v2\/contacts\/details\/\{id\}"/);
    assert.deepEqual(generated.pending, ['campos de resposta não verificáveis: GET /api/v2/contacts/details/{id}']);
    const missing = await generateContentPackage(root, { ...short, details: 'GET /contacts/unknown/{id}' }, { ...options, plan: { status: 'ready' } });
    assert.ok(missing.pending.includes('endpoint citado não encontrado (GET /contacts/unknown/{id})'), JSON.stringify(missing));
    const wrongVersion = await generateContentPackage(root, { ...short, details: 'GET /api/v9/contacts/details/{id}' }, { ...options, plan: { status: 'ready' } });
    assert.ok(wrongVersion.pending.includes('endpoint citado não encontrado (GET /api/v9/contacts/details/{id})'), JSON.stringify(wrongVersion));
    const wrongMethod = await generateContentPackage(root, { ...short, details: 'POST /contacts/details/{id}' }, { ...options, plan: { status: 'ready' } });
    assert.ok(wrongMethod.pending.includes('endpoint citado não encontrado (POST /contacts/details/{id})'), JSON.stringify(wrongMethod));
    assert.equal(prompts.length, 2);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
