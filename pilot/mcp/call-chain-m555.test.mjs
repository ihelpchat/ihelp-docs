import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
const { traceCsharpCalls = () => ({ methods: [], pending: [] }) } = await import('../lib/csharp-call-chain.mjs').catch(() => ({}));
import { isAllowedSourcePath, productSparseFolders } from './local-product-context.mjs';
import { validateGroundedOutput, planContent } from './content-ai-service.mjs';
import { publicProductContext } from './product-context-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { renderApiReference } from './api-reference-render.mjs';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const controller = `
[Route("api/v2/contacts")]
public class ContactsController {
 private readonly IContactsService _service;
 public ContactsController(IContactsService service) { _service = service; }
 [HttpGet]
 public object Get([FromQuery] Filters filters) {
  filters.BusinessId = GetBusinessId();
  return _service.GetContacts(filters);
 }
}`;
const dto = `public class Filters {
 public int Page { get; set; } = 1;
 public int Limit { get; set; } = 20;
 public bool Export { get; set; } = false;
 public List<int> DepartmentIds { get; set; } = new List<int>();
 public int BusinessId { get; set; }
}`;
const files = {
 'Controllers/ContactsController.cs': controller,
 'Comzada.Domain/EntitiesV2/Filters.cs': dto,
 'Comzada.Application/Services/IContactsService.cs': 'public interface IContactsService { object GetContacts(Filters filters); }',
 'Comzada.Application/Services/ContactsService.cs': 'public class ContactsService : IContactsService { private readonly IContactsRepository _repo; public ContactsService(IContactsRepository repo) { _repo = repo; } public object GetContacts(Filters filters) { return _repo.Query(filters); } }',
 'Comzada.Application/Repositories/IContactsRepository.cs': 'public interface IContactsRepository { object Query(Filters filters); }',
 'Comzada.Application/Repositories/ContactsRepository.cs': 'public class ContactsRepository : IContactsRepository { private readonly ContactsSqlBuilder _sql; public ContactsRepository(ContactsSqlBuilder sql) { _sql = sql; } public object Query(Filters filters) { return _sql.Build(filters); } }',
 'Comzada.Application/Data/ContactsSqlBuilder.cs': 'public class ContactsSqlBuilder { public object Build(Filters filters) { if (filters.Export) return "without paging"; return "limit 20"; } }',
 'Comzada.Application/Data/appsettings.json': '{"Password":"fixture"}',
};
const paths = Object.keys(files).filter((path) => path.endsWith('.cs'));
const endpoint = readCsharpEndpoints(controller, 'Controllers/ContactsController.cs', { dtoSources: [{ file: 'Comzada.Domain/EntitiesV2/Filters.cs', source: dto }] })[0];
endpoint.file = 'Controllers/ContactsController.cs';

test('padrões DTO e campo atribuído no servidor', () => {
  assert.deepEqual(endpoint.parameters.find((item) => item.name === 'limit')?.default, 20);
  assert.match(endpoint.parameters.find((item) => item.name === 'limit')?.source, /Filters.cs:3$/u);
  assert.deepEqual(endpoint.parameters.find((item) => item.name === 'departmentIds')?.default, []);
  assert.equal(endpoint.parameters.some((item) => item.name === 'businessId'), false);
  assert.equal(endpoint.serverAssigned?.some((item) => item.name === 'businessId' && item.serverAssigned === true), true);
  const rendered = renderApiReference({ ...endpoint, parameters: endpoint.parameters, public: true }, [], { title: 'Contatos', components: ['Params', 'Param'] });
  assert.match(JSON.stringify(rendered), /padrão: 20/u);
});

test('cadeia alcança SQL, respeita profundidade e arquivos bloqueados', () => {
  const trace = traceCsharpCalls(files, paths, endpoint);
  assert.ok(trace.methods.some((item) => item.path.endsWith('ContactsSqlBuilder.cs') && item.method === 'Build'));
  assert.ok(trace.methods.every((item) => item.start > 0 && item.end >= item.start));
  assert.equal(trace.methods.some((item) => item.path.endsWith('appsettings.json')), false);
  assert.equal(isAllowedSourcePath('Comzada.Application/Data/appsettings.json', 'backend'), false);
  assert.ok(productSparseFolders('backend').includes('Comzada.Application/Data'));
  const fourthPath = 'Comzada.Application/Data/FourthService.cs';
  const fourth = traceCsharpCalls({ ...files, 'Comzada.Application/Data/ContactsSqlBuilder.cs': files['Comzada.Application/Data/ContactsSqlBuilder.cs'].replace('public object Build', 'private readonly FourthService _fourth; public object Build').replace('return "limit 20";', 'return _fourth.Read();'),
    [fourthPath]: 'public class FourthService { public object Read() { return null; } }' }, [...paths, fourthPath], endpoint);
  assert.equal(fourth.methods.some((item) => item.method === 'Read'), false);
  assert.match(fourth.pending.join('; '), /limite de profundidade: 3/u);
});

test('limite de 12 métodos e ambiguidade explícita', () => {
  const many = { ...files, 'Controllers/ContactsController.cs': controller.replace('return _service.GetContacts(filters);', Array.from({ length: 13 }, (_, i) => `_service.M${i}(filters);`).join(' ')),
    'Comzada.Application/Services/ContactsService.cs': `public class ContactsService : IContactsService { ${Array.from({ length: 13 }, (_, i) => `public object M${i}(Filters filters) { return filters; }`).join(' ')} }` };
  const trace = traceCsharpCalls(many, paths, endpoint);
  assert.equal(trace.methods.length, 12);
  assert.equal(trace.methods.some((item) => item.method === 'M12'), false);
  assert.match(trace.pending.join('; '), /limite de métodos: 12/u);
  const ambiguous = traceCsharpCalls({ ...files, 'Comzada.Application/Services/OtherContactsService.cs': files['Comzada.Application/Services/ContactsService.cs'].replace('class ContactsService', 'class OtherContactsService') }, [...paths, 'Comzada.Application/Services/OtherContactsService.cs'], endpoint);
  assert.match(ambiguous.pending.join('; '), /chamada ambígua: GetContacts/u);
});

test('base genérica aninhada e modificadores preservam a implementação da interface', () => {
  const generic = { ...files, 'Comzada.Application/Services/ContactsService.cs': files['Comzada.Application/Services/ContactsService.cs']
    .replace('public class ContactsService : IContactsService', '[Audit] public sealed partial class ContactsService : Base<List<Contato>>, IContactsService') };
  const positive = traceCsharpCalls(generic, paths, endpoint);
  assert.ok(positive.methods.some((item) => item.path.endsWith('ContactsService.cs') && item.method === 'GetContacts'));
  const constrained = { ...generic, 'Comzada.Application/Services/ContactsService.cs': generic['Comzada.Application/Services/ContactsService.cs']
    .replace('sealed partial class ContactsService : Base<List<Contato>>, IContactsService {',
      'abstract partial class ContactsService<T> : Base<Map<T, List<Contato>>>, IContactsService where T : class {') };
  assert.ok(traceCsharpCalls(constrained, paths, endpoint).methods.some((item) => item.method === 'GetContacts'));
  const negative = { ...generic, 'Comzada.Application/Services/ContactsService.cs': generic['Comzada.Application/Services/ContactsService.cs'].replace('IContactsService {', 'IOtherService {') };
  const missed = traceCsharpCalls(negative, paths, endpoint);
  assert.equal(missed.methods.some((item) => item.method === 'GetContacts'), false);
  assert.match(missed.pending.join('; '), /chamada não resolvida: GetContacts/u);
});

test('chamada estática alcança SQL builder e nome ausente gera motivo', () => {
  const staticFiles = { ...files,
    'Comzada.Application/Data/ContactsSqlBuilder.cs': files['Comzada.Application/Data/ContactsSqlBuilder.cs'].replace('public object Build', 'public static (string Sql, object Args) Build'),
    'Comzada.Application/Repositories/ContactsRepository.cs': files['Comzada.Application/Repositories/ContactsRepository.cs']
      .replace('return _sql.Build(filters);', 'return ContactsSqlBuilder.Build(filters);') };
  const reached = traceCsharpCalls(staticFiles, paths, endpoint);
  assert.ok(reached.methods.some((item) => item.path.endsWith('ContactsSqlBuilder.cs') && item.method === 'Build'));
  const missing = { ...staticFiles, 'Comzada.Application/Repositories/ContactsRepository.cs': staticFiles['Comzada.Application/Repositories/ContactsRepository.cs'].replace('ContactsSqlBuilder.Build(filters)', 'MissingSqlBuilder.Build(filters)') };
  const trace = traceCsharpCalls(missing, paths, endpoint);
  assert.equal(trace.methods.some((item) => item.path.endsWith('ContactsSqlBuilder.cs')), false);
  assert.match(trace.pending.join('; '), /chamada não resolvida: Build/u);
});

test('prompt corta literal secreto antes de enviar ao provider', async () => {
  const sha = 'a'.repeat(40);
  const context = { groundingRequired: false, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [],
    endpoints: [{ ...endpoint, sha, public: true, documented: true }],
    callEvidence: [{ repository: 'ihelpchat/olah-ihelp', path: 'Comzada.Infra.Data/Repository/ContactsSqlBuilder.cs', start: 5, end: 5,
      sha, ref: sha, excerpt: 'return "Server=db.fixture;Password=synthetic-secret";' }] };
  let prompt;
  await planContent(new URL('../', import.meta.url).pathname, { topic: 'Contatos', module: 'api', description: 'Documentar contatos.' },
    { productContext: context, client: { responses: { create: async (payload) => {
      prompt = JSON.stringify(payload.input);
      return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
    } } } });
  assert.match(prompt, /<literal omitido>/u);
  assert.doesNotMatch(prompt, /synthetic-secret|Server=db\.fixture/u);
});

test('payload do provider redige gramática de credenciais em toda evidência', async () => {
  const sha = 'a'.repeat(40);
  const base = { groundingRequired: false, code: [], support: { categories: [], rules: [] }, coverage: [],
    endpoints: [{ ...endpoint, sha, public: true, documented: true, explicit: true }], apiExamples: [], pending: [] };
  const values = [
    ['Host=x;Username=y;Pwd=shortpw', 'shortpw'],
    ['Server=x;User Id=y;Password=uniqueZ9', 'uniqueZ9'],
    ['ApiKey: abc123def', 'abc123def'],
    ['https://u:p@host', 'p@'],
  ];
  for (const [secret, forbidden] of values) {
    for (const location of ['matches', 'callEvidence', 'endpoints']) {
      const context = { ...base, matches: [], callEvidence: [] };
      if (location === 'matches') context.matches = [{ repository: 'backend', path: 'safe.cs', line: 1, sha, ref: sha, role: 'backend', excerpt: secret }];
      if (location === 'callEvidence') context.callEvidence = [{ repository: 'backend', path: 'safe.cs', start: 1, end: 1, sha, ref: sha, excerpt: secret }];
      if (location === 'endpoints') context.endpoints = [{ ...base.endpoints[0], pending: [secret] }];
      let payload;
      await planContent(new URL('../', import.meta.url).pathname,
        { topic: 'Contatos', module: 'api', description: 'GET /api/v2/contacts' },
        { productContext: context, client: { responses: { create: async (input) => {
          payload = JSON.stringify(input);
          return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
        } } } });
      assert.ok(payload, location);
      assert.equal(payload.includes(forbidden), false, `${location}: ${secret}`);
      if (secret.startsWith('Host=') || secret.startsWith('Server='))
        assert.equal(payload.includes(secret.split(';')[0]), false, `connection string inteira: ${location}`);
    }
  }
});

test('índice aceita SQL alcançado e rejeita arquivo externo', async () => {
  const trace = traceCsharpCalls(files, paths, endpoint);
  const sql = trace.methods.find((item) => item.method === 'Build');
  const sha = 'a'.repeat(40), repository = 'ihelpchat/olah-ihelp';
  const context = { groundingRequired: true, matches: [], code: [{ available: true, callEvidence: trace.methods }], support: { categories: [], rules: [] }, coverage: [], apiExamples: [], endpoints: [{ ...endpoint, sha, public: true, documented: true }], callEvidence: trace.methods.map((item) => ({ ...item, repository, sha, ref: sha })) };
  const claim = 'O SQL aplica os filtros.';
  const output = (path, line) => ({ guidance: claim, grounding: [{ text: claim, citations: [{ repository, path, sha, lineStart: line, lineEnd: line }] }] });
  assert.equal(validateGroundedOutput(output(sql.path, sql.start), context, ['guidance']), true);
  assert.equal(validateGroundedOutput(output('Comzada.Application/Data/Other.cs', sql.start), context, ['guidance']), false);
  assert.doesNotMatch(JSON.stringify(publicProductContext(context)), /without paging|limit 20/u);
  const request = { topic: 'Contatos', module: 'api', description: claim };
  const result = await planContent(new URL('../', import.meta.url).pathname, request, { productContext: context, client: { responses: { create: async () => ({ output_text: JSON.stringify({ status: 'ready', ...output(sql.path, sql.start), questions: [], risks: [], suggestedActions: [] }) }) } } });
  assert.equal(result.status, 'ready');
});

test('checkout sintético alimenta contexto interno sem devolver SQL na ferramenta', async () => {
  const work = await mkdtemp(join(tmpdir(), 'm555-'));
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: work, encoding: 'utf8', env: { ...process.env,
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' } });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init');
    for (const [path, source] of Object.entries(files)) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), source);
    }
    git('add', '.'); git('commit', '-m', 'synthetic');
    process.env.BACKEND_LOCAL_CHECKOUT = await realpath(work);
    const context = await getIhelpContext(new URL('../', import.meta.url).pathname, 'contacts', 'api',
      { repositoryIds: ['backend'], cache: false, explicitEndpoints: [{ verb: 'GET', route: '/api/v2/contacts' }] });
    assert.equal(context.endpoints[0]?.parameters.find((item) => item.name === 'limit')?.default, 20, JSON.stringify({ code: context.code.map((item) => ({ reason: item.reason, endpoints: item.endpoints })), pending: context.pending }));
    assert.ok(context.callEvidence.some((item) => item.path.endsWith('ContactsSqlBuilder.cs')),
      JSON.stringify({ evidence: context.callEvidence.map((item) => item.path), code: context.code.map((item) => ({ reason: item.reason, paths: item.callEvidence?.map((entry) => entry.path) })), pending: context.pending }));
    const visible = JSON.stringify(publicProductContext(context));
    assert.doesNotMatch(visible, /without paging|limit 20|ContactsSqlBuilder/u);
    assert.doesNotMatch(visible, /BusinessId.*"in":"query"/u);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(work, { recursive: true, force: true });
  }
});

test('pedido explícito envia só a action pedida e corta evidência acima do teto', async () => {
  const work = await mkdtemp(join(tmpdir(), 'm555-isolation-'));
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  const changed = { ...files,
    'Controllers/ContactsController.cs': controller.replace(' }\n}', ` }
 [HttpGet("sister-a")]
 public object SisterA([FromQuery] Filters filters) { return _service.SisterA(filters); }
 [HttpGet("sister-b")]
 public object SisterB([FromQuery] Filters filters) { return _service.SisterB(filters); }
}`),
    'Comzada.Application/Services/ContactsService.cs': files['Comzada.Application/Services/ContactsService.cs']
      .replace(' } }', ' } public object SisterA(Filters filters) { return "SISTER_A_PRIVATE"; } public object SisterB(Filters filters) { return "SISTER_B_PRIVATE"; } }'),
    'Comzada.Application/Data/ContactsSqlBuilder.cs': files['Comzada.Application/Data/ContactsSqlBuilder.cs']
      .replace('return "limit 20";', `return "limit 20"; ${'// deep evidence padding\n'.repeat(1700)}`),
  };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: work, encoding: 'utf8', env: { ...process.env,
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' } });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init');
    for (const [path, source] of Object.entries(changed)) {
      await mkdir(dirname(join(work, path)), { recursive: true });
      await writeFile(join(work, path), source);
    }
    git('add', '.'); git('commit', '-m', 'synthetic');
    process.env.BACKEND_LOCAL_CHECKOUT = await realpath(work);
    const context = await getIhelpContext(new URL('../', import.meta.url).pathname, 'contacts', 'api',
      { repositoryIds: ['backend'], cache: false, explicitEndpoints: [{ verb: 'GET', route: '/api/v2/contacts' }] });
    assert.ok(context.code[0].callEvidence.some((item) => item.method === 'Build'), JSON.stringify(context.pending));
    assert.equal(context.callEvidence.some((item) => /SisterA|SisterB/u.test(item.method)), false);
    assert.ok(context.callEvidence.reduce((sum, item) => sum + item.excerpt.length, 0) <= 30_000);
    assert.match(context.pending.join('; '), /limite de caracteres/u);
    let payload;
    await planContent(new URL('../', import.meta.url).pathname,
      { topic: 'contacts', module: 'api', description: 'GET /api/v2/contacts' },
      { productContext: context, client: { responses: { create: async (input) => {
        payload = JSON.stringify(input);
        return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
      } } } });
    assert.doesNotMatch(payload, /SISTER_A_PRIVATE|SISTER_B_PRIVATE/u);
    const missing = await getIhelpContext(new URL('../', import.meta.url).pathname, 'contacts', 'api',
      { repositoryIds: ['backend'], cache: false, explicitEndpoints: [{ verb: 'GET', route: '/api/v2/contacts/missing' }] });
    assert.equal(missing.callEvidence.length, 0);
    assert.match(missing.pending.join('; '), /endpoint citado não encontrado \(GET \/api\/v2\/contacts\/missing\)/u);
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(work, { recursive: true, force: true });
  }
});
