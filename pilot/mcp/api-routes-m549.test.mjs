import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { renderApiReference } from './api-reference-render.mjs';

const optional = `[ApiVersion("2")][Route("api/v{version:apiVersion}/contacts")]
public class ContactsController {
  [HttpGet("{letter?}")]
  public IActionResult Get([FromRoute] string? letter) { return null; }
}`;
const absolute = (prefix) => `[ApiVersion("2")][Route("api/v{version:apiVersion}/contactTags")]
public class ContactsController {
  [HttpPost("${prefix}api/v2/crm/contacts/{contactId}/tags")]
  public IActionResult Post([FromRoute] int contactId) { return null; }
}`;

async function contextFor(source, requested, { topic = 'API Contatos', repeat = 1, readFile: reader, cache = false } = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'api-routes-m549-'));
  const backend = join(root, 'back');
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  try {
    const controllers = join(backend, 'Comzada.Application/Controllers/V2');
    await mkdir(controllers, { recursive: true });
    await writeFile(join(controllers, 'ContactsController.cs'), source);
    execFileSync('git', ['init', '-q', backend]);
    execFileSync('git', ['-C', backend, 'add', '.']);
    execFileSync('git', ['-C', backend, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    await mkdir(join(root, 'architecture'), { recursive: true });
    await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: [] }));
    await writeFile(join(root, 'architecture/coverage-matrix.json'), '[]');
    process.env.BACKEND_LOCAL_CHECKOUT = backend;
    const contexts = [];
    for (let index = 0; index < repeat; index += 1) contexts.push(await getIhelpContext(root, topic, 'api', {
      requireLocal: true, repositoryIds: ['backend'], explicitEndpoints: [requested], cache, readFile: reader,
    }));
    return repeat === 1 ? contexts[0] : contexts;
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test('rota opcional casa com e sem o segmento e a página o marca opcional', async () => {
  for (const route of ['/api/v2/contacts', '/api/v2/contacts/abc']) {
    const context = await contextFor(optional, { verb: 'GET', route });
    assert.equal(context.endpoints[0]?.route, '/api/v2/contacts/{letter}');
    assert.equal(context.endpoints[0]?.explicit, true);
    assert.ok(!context.pending.some((reason) => reason.startsWith('endpoint citado não encontrado')), context.pending.join('; '));
  }
  const [fact] = readCsharpEndpoints(optional, 'Controllers/ContactsController.cs', { dtoSources: [] });
  const rendered = renderApiReference(fact, [{ components: ['Params', 'Param'], sections: ['Parâmetros de rota'] }]);
  assert.match(rendered.body, /<Param name="letter" type="string">route \(string\), opcional<\/Param>/);
  const constrained = await contextFor(optional.replace('{letter?}', '{letter:alpha?}'), { verb: 'GET', route: '/api/v2/contacts' });
  assert.equal(constrained.endpoints[0]?.explicit, true);
});

test('tema genérico seleciona action absoluta citada com valor concreto', async () => {
  const requested = { verb: 'POST', route: '/api/v2/crm/contacts/42/tags' };
  const context = await contextFor(absolute('/'), requested, { topic: 'Referência da API' });
  assert.equal(context.endpoints[0]?.route, '/api/v2/crm/contacts/{contactId}/tags');
  assert.equal(context.endpoints[0]?.explicit, true);
  assert.ok(!context.pending.some((reason) => reason.startsWith('endpoint citado não encontrado')), context.pending.join('; '));

  const missing = await contextFor(absolute('/'), { ...requested, route: '/api/v2/crm/contacts/42/unknown' }, { topic: 'Referência da API' });
  assert.ok(missing.pending.includes('endpoint citado não encontrado (POST /api/v2/crm/contacts/42/unknown)'), missing.pending.join('; '));
});

test('tema genérico seleciona action opcional com e sem segmento', async () => {
  const source = optional.replace('{letter?}', '{letter:alpha?}');
  for (const route of ['/api/v2/contacts/abc', '/api/v2/contacts']) {
    const context = await contextFor(source, { verb: 'GET', route }, { topic: 'Referência da API' });
    assert.equal(context.endpoints[0]?.explicit, true, context.pending.join('; '));
    assert.ok(!context.pending.some((reason) => reason.startsWith('endpoint citado não encontrado')), context.pending.join('; '));
  }
  const missing = await contextFor(source, { verb: 'GET', route: '/api/v2/unknown' }, { topic: 'Referência da API' });
  assert.ok(missing.pending.includes('endpoint citado não encontrado (GET /api/v2/unknown)'), missing.pending.join('; '));
});

test('controller citado usa cache por caminho e mtime entre pedidos', async () => {
  let reads = 0;
  const reader = async (path, options) => {
    if (path.endsWith('ContactsController.cs')) reads += 1;
    return readFile(path, options);
  };
  const contexts = await contextFor(optional, { verb: 'GET', route: '/api/v2/contacts/abc' }, {
    topic: 'Referência da API', repeat: 2, cache: true, readFile: reader,
  });
  assert.equal(contexts.length, 2);
  assert.equal(contexts[1].endpoints[0]?.explicit, true);
  assert.equal(reads, 1, `controller lido ${reads} vezes`);
});

test('rota opcional não aceita prefixo parecido; segmento obrigatório não aceita rota curta', async () => {
  const typo = await contextFor(optional, { verb: 'GET', route: '/api/v2/contactsx' });
  assert.ok(typo.pending.includes('endpoint citado não encontrado (GET /api/v2/contactsx)'), typo.pending.join('; '));
  const mandatory = await contextFor(optional.replace('{letter?}', '{letter}'), { verb: 'GET', route: '/api/v2/contacts' });
  assert.ok(mandatory.pending.includes('endpoint citado não encontrado (GET /api/v2/contacts)'), mandatory.pending.join('; '));
});

for (const prefix of ['/', '~/']) test(`action ${prefix} substitui a rota da classe`, async () => {
  const source = absolute(prefix);
  const [fact] = readCsharpEndpoints(source, 'Controllers/ContactsController.cs', { dtoSources: [] });
  assert.equal(fact.route, '/api/v2/crm/contacts/{contactId}/tags');
  const requested = { verb: 'POST', route: '/api/v2/crm/contacts/{contactId}/tags' };
  const context = await contextFor(source, requested);
  assert.equal(context.endpoints[0]?.explicit, true);
  assert.ok(!context.pending.some((reason) => reason.startsWith('endpoint citado não encontrado')), context.pending.join('; '));
  const relative = await contextFor(absolute(''), requested);
  assert.ok(relative.pending.includes('endpoint citado não encontrado (POST /api/v2/crm/contacts/{contactId}/tags)'), relative.pending.join('; '));
});
