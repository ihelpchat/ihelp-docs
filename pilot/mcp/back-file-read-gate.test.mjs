import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { searchLocalProductContext } from './local-product-context.mjs';
const { canReadBackFile = () => true } = await import('./back-file-reader.mjs').catch(() => ({}));

const controller = '[Route("api/v2/test")] public class TestController { private readonly ITestService _service; public TestController(ITestService service) { _service = service; } [HttpGet] public object Get() { return _service.Get(); } }';
const service = (type) => `public class TestService : ITestService { private readonly ${type} _data; public TestService(${type} data) { _data = data; } public object Get() { return _data.Build(); } }`;
const files = (type) => ({
  'Controllers/TestController.cs': controller,
  'Comzada.Application/Services/TestService.cs': service(type),
  [`Comzada.Application/Data/${type}.cs`]: `public class ${type} { public object Build() { return 1; } }`,
  'Comzada.Application/Data/appsettings.Production.json': '{"Password":"fixture"}',
});
async function fixture(type, check) {
  const root = await mkdtemp(join(tmpdir(), 'm555-gate-'));
  const previous = process.env.BACKEND_LOCAL_CHECKOUT;
  try {
    for (const [path, source] of Object.entries(files(type))) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    process.env.BACKEND_LOCAL_CHECKOUT = await realpath(root);
    const reads = [], stats = [];
    const result = await searchLocalProductContext('test', 'api', {
      repositoryIds: ['backend'], cache: false, explicitEndpoints: [{ verb: 'GET', route: '/api/v2/test' }],
      readFile: async (path, options) => { reads.push(path); return readFile(path, { encoding: 'utf8', ...options }); },
      stat: async (path) => { stats.push(path); return lstat(path); },
    });
    assert.equal(reads.some((path) => path.endsWith('/appsettings.Production.json')), false);
    assert.equal(stats.some((path) => path.endsWith('/appsettings.Production.json')), false);
    check({ result, reads, stats });
  } finally {
    if (previous === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test('campo ConnectionStrings é bloqueado antes de readFile e stat, com pendência sem conteúdo', async () => {
  await fixture('ConnectionStrings', ({ result, reads, stats }) => {
    assert.equal(reads.some((path) => path.endsWith('/ConnectionStrings.cs')), false);
    assert.equal(stats.some((path) => path.endsWith('/ConnectionStrings.cs')), false);
    assert.match(JSON.stringify(result.code[0].endpoints[0].pending), /arquivo de configuração não lido: ConnectionStrings/u);
    assert.equal(result.code[0].callEvidence.some((item) => item.path.endsWith('ConnectionStrings.cs')), false);
  });
});

test('mesma action com serviço comum permite a leitura', async () => {
  await fixture('ContactRules', ({ result, reads }) => {
    assert.ok(reads.some((path) => path.endsWith('/ContactRules.cs')));
    assert.ok(result.code[0].callEvidence.some((item) => item.path.endsWith('ContactRules.cs')));
    assert.doesNotMatch(JSON.stringify(result.code[0].endpoints[0].pending), /arquivo de configuração não lido/u);
  });
});

test('allowlist recusa appsettings antes de qualquer acesso', () => {
  assert.equal(canReadBackFile('Comzada.Application/Data/appsettings.Production.json'), false);
  assert.equal(canReadBackFile('Comzada.Application/Data/ContactRules.cs'), true);
  for (const name of ['ConnectionStrings.cs', 'SecretStore.cs', 'Credentials.cs', 'PasswordRules.cs',
    'AppSettings.cs', '.env.cs', 'KeyVault.cs', 'Certificate.cs'])
    assert.equal(canReadBackFile(`Comzada.Application/Data/${name}`), false, name);
  for (const path of ['bin/ContactRules.cs', 'obj/ContactRules.cs', 'Tests/ContactRules.cs',
    '../ContactRules.cs', 'Comzada.Application/Data/contact.config', 'Comzada.Application/Data/cert.pem'])
    assert.equal(canReadBackFile(path), false, path);
});

test('arquitetura: acesso ao conteúdo do back só pelo helper', async () => {
  const context = await readFile(new URL('./local-product-context.mjs', import.meta.url), 'utf8');
  const chain = await readFile(new URL('../lib/csharp-call-chain.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(context, /\b(?:readFile|readFileSync)\s*\(/u);
  assert.doesNotMatch(chain, /\b(?:readFile|readFileSync)\s*\(/u);
});
