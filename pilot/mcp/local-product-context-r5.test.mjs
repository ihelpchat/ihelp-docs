import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { searchLocalProductContext } from './local-product-context.mjs';

const root = await realpath(await mkdtemp(join(tmpdir(), 'm530-r5-')));
const checkout = join(root, 'front');
await mkdir(join(checkout, 'src/pages/Robots'), { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Fixture');
const target = 'src/pages/Robots/Target.tsx';
await writeFile(join(checkout, target), 'export const label = "Criar robô de atendimento";');
for (let index = 0; index < 5_000; index += 1) {
  await writeFile(join(checkout, `src/pages/Robots/Other${index}.tsx`), 'export const label = "outra tela";');
}
git('add', '-A');
git('commit', '-qm', 'large tracked fixture');
const previous = process.env.PRODUCT_LOCAL_CHECKOUT;
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
try {
  const reads = [];
  const reader = async (path, options) => { reads.push(path); return readFile(path, options); };
  const started = performance.now();
  const result = await searchLocalProductContext('Criar robô de atendimento', '', {
    repositoryIds: ['frontend'], deadlineMs: 10_000, readFile: reader,
  });
  assert.equal(result.code[0].available, true, result.code[0].reason);
  assert.equal(result.partial, false);
  assert.equal(result.matches[0]?.path, target);
  assert.ok(performance.now() - started < 10_000, '5.000 arquivos devem fechar dentro do prazo');
  assert.deepEqual(reads.map((path) => path.slice(checkout.length + 1)), [target], 'rg seleciona antes de ler');

  const again = await searchLocalProductContext('Criar robô de atendimento', '', {
    repositoryIds: ['frontend'], deadlineMs: 10_000, readFile: reader,
  });
  assert.equal(again.matches[0]?.path, target);
  assert.equal(reads.length, 1, 'cache por SHA não relê o candidato');

  const slowStarted = performance.now();
  const slow = await searchLocalProductContext('Criar robô de atendimento', '', {
    repositoryIds: ['frontend'], deadlineMs: 150, readFile: async () => new Promise((resolve) => setTimeout(() => resolve(''), 2_000)),
    cache: false,
  });
  assert.ok(slow.partial || slow.code[0].reason, 'prazo devolve estado explícito');
  assert.ok(performance.now() - slowStarted <= 1_150, 'leitura lenta não pode prender a operação');
} finally {
  if (previous === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
  else process.env.PRODUCT_LOCAL_CHECKOUT = previous;
}
console.log('M5.30 r5: seleção antes da leitura, cache e deadline global.');
