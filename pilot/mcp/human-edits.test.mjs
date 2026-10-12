import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { reconcileHumanUpdate } from './human-edits.mjs';

const run = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const page = 'pilot/content/docs/docs/exemplo.mdx';
const base = '---\ntitle: Exemplo\nmcpGeneratedSha: SEED\n---\n\n## Afetada\n\nTexto original.\n\n## Livre\n\nTexto livre.\n';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'm560-'));
  run(root, 'init', '-q');
  run(root, 'config', 'user.name', 'MCP Bot');
  run(root, 'config', 'user.email', 'mcp-bot@example.test');
  run(root, 'commit', '--allow-empty', '-qm', 'seed');
  const seed = run(root, 'rev-parse', 'HEAD');
  await mkdir(join(root, 'pilot/content/docs/docs'), { recursive: true });
  await writeFile(join(root, page), base.replace('SEED', seed));
  run(root, 'add', page); run(root, 'commit', '-qm', 'MCP generation');
  return { root, seed, original: base.replace('SEED', seed) };
}
async function human(f, content) {
  await writeFile(join(f.root, page), content);
  run(f.root, '-c', 'user.name=Editor Humano', '-c', 'user.email=editor@example.test', 'commit', '-qam', 'human edit');
}
const proposed = (f) => f.original.replace('Texto original.', 'Texto novo do produto.');
{
  const f = await fixture();
  const result = await reconcileHumanUpdate(f.root, page, proposed(f));
  assert.equal(result.status, 'update');
  assert.match(result.content, /Texto novo do produto/);
}
{
  const f = await fixture();
  const edited = f.original.replace('Texto livre.', 'Texto livre alterado à mão.\n\nLinha extra mantida.');
  await human(f, edited);
  const result = await reconcileHumanUpdate(f.root, page, proposed(f));
  assert.equal(result.status, 'update');
  assert.ok(result.content.includes('Texto livre alterado à mão.\n\nLinha extra mantida.'));
  assert.match(result.notice, /preservad/iu);
}
{
  const f = await fixture();
  const edited = f.original.replace('Texto original.', 'Texto humano.');
  await human(f, edited);
  const result = await reconcileHumanUpdate(f.root, page, proposed(f));
  assert.equal(result.status, 'conflict');
  assert.equal(await readFile(join(f.root, page), 'utf8'), edited);
  assert.match(result.notice, /Texto humano/);
  assert.match(result.notice, /Texto novo do produto/);
}
{
  const f = await fixture();
  const locked = f.original.replace('title: Exemplo', 'title: Exemplo\nmanual: true');
  await human(f, locked);
  const result = await reconcileHumanUpdate(f.root, page, proposed(f));
  assert.equal(result.status, 'manual');
  assert.match(result.notice, /Texto novo do produto/);
}
{
  const f = await fixture();
  await human(f, f.original.replace('Texto original.', 'Texto humano.'));
  const real = await reconcileHumanUpdate(f.root, page, proposed(f));
  assert.equal(real.status, 'conflict', 'mutação vermelha: ignorar histórico não pode retornar update');
}
console.log('human edits: ok');
