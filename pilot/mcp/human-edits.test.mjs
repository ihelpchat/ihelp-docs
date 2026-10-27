import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { reconcileHumanUpdate } from './human-edits.mjs';

const run = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const page = 'pilot/content/docs/docs/exemplo.mdx';
const base = '---\ntitle: Exemplo\nmcpGeneratedSha: SEED\n---\n\n## Afetada\n\nTexto original.\n\n## Livre\n\nTexto livre.\n';
async function fixture(template = base) {
  const root = await mkdtemp(join(tmpdir(), 'm560-'));
  run(root, 'init', '-q');
  run(root, 'config', 'user.name', 'MCP Bot');
  run(root, 'config', 'user.email', 'mcp-bot@users.noreply.github.com');
  run(root, 'commit', '--allow-empty', '-qm', 'seed');
  const seed = run(root, 'rev-parse', 'HEAD');
  await mkdir(join(root, 'pilot/content/docs/docs'), { recursive: true });
  await writeFile(join(root, page), template.replace('SEED', seed));
  run(root, 'add', page); run(root, 'commit', '-qm', 'MCP generation');
  return { root, seed, original: template.replace('SEED', seed) };
}
async function human(f, content) {
  await writeFile(join(f.root, page), content);
  run(f.root, '-c', 'user.name=Editor Humano', '-c', 'user.email=editor@example.test', 'commit', '-qam', 'human edit');
}
const proposed = (f) => f.original.replace('Texto original.', 'Texto novo do produto.');
{
  const nested = base.replace('Texto original.', '### Passo um\n\nTexto original.\n\n### Passo dois\n\nOutro passo.');
  const f = await fixture(nested);
  const edited = f.original.replace('Outro passo.', 'Outro passo editado à mão.');
  await human(f, edited);
  const result = await reconcileHumanUpdate(f.root, page, f.original.replace('Texto original.', 'Texto novo do produto.'));
  assert.equal(result.status, 'update');
  assert.match(result.content, /Outro passo editado à mão/);
  assert.match(result.content, /Texto novo do produto/);
}
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
  const serverRootResult = await reconcileHumanUpdate(join(f.root, 'pilot'), 'content/docs/docs/exemplo.mdx', proposed(f), edited);
  assert.equal(serverRootResult.status, 'update', 'checkout do servidor usa pilot/ como root');
  assert.equal(serverRootResult.content, result.content);
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
{
  const f = await fixture(base.replace('mcpGeneratedSha: SEED\n', ''));
  const baseline = run(f.root, 'rev-parse', 'HEAD');
  await writeFile(join(f.root, page), f.original.replace('title: Exemplo\n', `title: Exemplo\nmcpGeneratedSha: ${baseline}\n`));
  run(f.root, '-c', 'user.name=Editor Humano', '-c', 'user.email=editor@example.test', 'commit', '-qam', 'adoption');
  const current = await readFile(join(f.root, page), 'utf8');
  const result = await reconcileHumanUpdate(f.root, page, current.replace('Texto original.', 'Texto novo do produto.'));
  assert.equal(result.status, 'update', 'adoção declarada permite atualização');
  assert.match(result.content, /Texto novo do produto/);
  await human(f, current.replace('Texto livre.', 'Texto humano.'));
  const merged = await reconcileHumanUpdate(f.root, page, current.replace('Texto original.', 'Texto novo do produto.'));
  assert.equal(merged.status, 'update');
  assert.match(merged.content, /Texto humano/);
}
{
  const f = await fixture(base.replace('mcpGeneratedSha: SEED\n', ''));
  const result = await reconcileHumanUpdate(f.root, page, f.original.replace('Texto original.', 'Texto novo do produto.'));
  assert.equal(result.status, 'conflict', 'página nova sem marcador falha fechada');
}
for (const moduleName of ['Canais', 'Departamentos']) {
  const source = base.replace('## Afetada', `## ${moduleName}`).replace('## Livre', '## Usuários');
  const f = await fixture(source);
  await human(f, f.original.replace('Texto livre.', 'Texto humano preservado.'));
  const proposal = f.original.replace(`## ${moduleName}\n\nTexto original.`, `## ${moduleName}\n\nTexto original.\n\n### QR\n\nNovo passo.`);
  const result = await reconcileHumanUpdate(f.root, page, proposal);
  assert.equal(result.status, 'update');
  assert.ok(result.content.indexOf(`## ${moduleName}`) < result.content.indexOf('### QR'));
  assert.ok(result.content.indexOf('### QR') < result.content.indexOf('## Usuários'));
  assert.ok(result.content.includes('## Usuários\n\nTexto humano preservado.'));
}
{
  const f = await fixture();
  await writeFile(join(f.root, '.git/shallow'), `${run(f.root, 'rev-parse', 'HEAD')}\n`);
  const result = await reconcileHumanUpdate(f.root, page, proposed(f));
  assert.equal(result.status, 'conflict', 'checkout raso deve falhar fechado');
  assert.match(result.notice, /Histórico Git incompleto/);
}
console.log('human edits: ok');
