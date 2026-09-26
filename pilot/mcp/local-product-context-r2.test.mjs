import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchLocalProductContext } from './local-product-context.mjs';
import { planContent } from './content-ai-service.mjs';

const base = await realpath(await mkdtemp(join(tmpdir(), 'm530-r2-')));
const checkout = join(base, 'front');
await mkdir(checkout);
const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Fixture');
const write = async (path, content) => {
  await mkdir(join(checkout, path, '..'), { recursive: true });
  await writeFile(join(checkout, path), content);
};
const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); };
const search = () => searchLocalProductContext('Criar robô', 'Robôs', { repositoryIds: ['frontend'] });
const original = process.env.PRODUCT_LOCAL_CHECKOUT;
process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
try {
  await write('src/pages/Robots/Safe.tsx', 'export const label = "Criar robô";');
  await write('src/pages/Robots/Internal.tsx', '// Criar robô. INTERNO: fixture-operational-only');
  await write('src/pages/Robots/Homoglyph.tsx', '// Criar robô. INTЕRNO: fixture-homoglyph-only');
  commit();
  const safe = await search();
  assert.equal(safe.code[0].available, true, safe.code[0].reason);
  assert.deepEqual(safe.matches.map(({ path }) => path), ['src/pages/Robots/Safe.tsx'], 'arquivo com marcador inteiro é descartado');
  let captured;
  await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Criar robô', module: 'Robôs', description: 'Explicar a tela.' },
    { contextOptions: { repositoryIds: ['frontend'] }, client: { responses: { create: async (request) => {
      captured = JSON.stringify(request);
      return { model: 'fixture', output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
    } } } });
  assert.ok(captured, 'requisição chegou ao client');
  assert.doesNotMatch(captured, /fixture-operational-only|fixture-homoglyph-only|Internal\.tsx|Homoglyph\.tsx/);

  const boundary = join(base, 'boundary');
  await mkdir(boundary);
  process.env.PRODUCT_LOCAL_CHECKOUT = boundary;
  const boundaryGit = (...args) => execFileSync('git', args, { cwd: boundary, encoding: 'utf8' }).trim();
  boundaryGit('init', '-q');
  boundaryGit('config', 'user.email', 'test@example.invalid');
  boundaryGit('config', 'user.name', 'Fixture');
  const prefix = 'export const label = "Criar robô";\n';
  await mkdir(join(boundary, 'src/pages'), { recursive: true });
  const source = join(boundary, 'src/pages/Robots.tsx');
  await writeFile(source, prefix + ' '.repeat(256_000 - Buffer.byteLength(prefix)));
  boundaryGit('add', '-A'); boundaryGit('commit', '-qm', '256000 bytes');
  const atLimit = await search();
  assert.equal(atLimit.code[0].available, true, atLimit.code[0].reason);
  assert.equal(atLimit.matches[0]?.path, 'src/pages/Robots.tsx', '256000 bytes aceitos');
  await writeFile(source, prefix + ' '.repeat(256_001 - Buffer.byteLength(prefix)));
  boundaryGit('add', '-A'); boundaryGit('commit', '-qm', '256001 bytes');
  const fakeBin = join(base, 'fake-bin');
  await mkdir(fakeBin);
  const rgCalled = join(base, 'rg-called');
  await writeFile(join(fakeBin, 'rg'), `#!/bin/sh\ntouch '${rgCalled}'\nexit 1\n`);
  await chmod(join(fakeBin, 'rg'), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${oldPath}`;
  let aboveLimit;
  try { aboveLimit = await search(); } finally { process.env.PATH = oldPath; }
  assert.equal(aboveLimit.code[0].available, true, aboveLimit.code[0].reason);
  assert.deepEqual(aboveLimit.matches, [], '256001 bytes recusados antes da busca');
  assert.equal(existsSync(rgCalled), false, 'rg não é chamado para arquivo acima do teto');

  const many = join(base, 'many');
  await mkdir(many);
  process.env.PRODUCT_LOCAL_CHECKOUT = many;
  const manyGit = (...args) => execFileSync('git', args, { cwd: many, encoding: 'utf8' }).trim();
  manyGit('init', '-q');
  manyGit('config', 'user.email', 'test@example.invalid');
  manyGit('config', 'user.name', 'Fixture');
  for (let start = 0; start < 10_000; start += 200) {
    await Promise.all(Array.from({ length: 200 }, (_, offset) =>
      writeFile(join(many, `file-${String(start + offset).padStart(5, '0')}.txt`), 'fixture')));
  }
  manyGit('add', '-A'); manyGit('commit', '-qm', '10000 files');
  const tenThousand = await search();
  assert.equal(tenThousand.code[0].available, true, '10000 arquivos rastreados aceitos');
  await writeFile(join(many, 'file-10000.txt'), 'fixture');
  manyGit('add', '-A'); manyGit('commit', '-qm', '10001 files');
  const tooMany = await search();
  assert.equal(tooMany.code[0].available, false, '10001 arquivos rastreados falham fechado');
  assert.match(tooMany.code[0].reason, /Limite de arquivos listados/);
  assert.deepEqual(tooMany.matches, []);
} finally {
  if (original === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
  else process.env.PRODUCT_LOCAL_CHECKOUT = original;
}
console.log('M5.30 r2: marcadores internos e fronteiras de bytes/arquivos passaram.');
