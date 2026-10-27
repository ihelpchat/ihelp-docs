import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MCP_GIT_AUTHOR, reconcileHumanUpdate } from './human-edits.mjs';

const git = (root, ...args) => execFileSync('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8' }).trim();
const roots = [];
const path = 'exemplo.mdx';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'm560-cycles-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', MCP_GIT_AUTHOR.name);
  git(root, 'config', 'user.email', MCP_GIT_AUTHOR.email);
  git(root, 'commit', '--allow-empty', '-qm', 'seed');
  const original = `---\ntitle: Exemplo\nmcpGeneratedSha: ${git(root, 'rev-parse', 'HEAD')}\n---\n\n## Produto\n\nProduto v1.\n\n## Humana\n\nTexto original.\n`;
  await writeFile(join(root, path), original);
  git(root, 'add', path);
  git(root, 'commit', '-qm', 'MCP generation');
  return { root, original };
}
async function commit(root, content, human = false) {
  await writeFile(join(root, path), content);
  git(root, ...(human ? ['-c', 'user.name=Conta compartilhada', '-c', 'user.email=editor@example.test'] : []),
    'commit', '-qam', human ? 'contribuição humana' : 'MCP preserva contribuição humana');
}

try {
  // Atualizações automáticas continuam permitidas em ciclos sucessivos.
  {
    const { root, original } = await fixture();
    let current = original;
    for (let cycle = 2; cycle <= 4; cycle += 1) {
      const result = await reconcileHumanUpdate(root, path, current.replace(`Produto v${cycle - 1}.`, `Produto v${cycle}.`));
      assert.equal(result.status, 'update');
      assert.ok(result.content.includes(`Produto v${cycle}.`));
      await commit(root, result.content);
      current = result.content;
    }
  }
  // Cada commit intermediário preserva bytes, mas não pode apagar proveniência.
  for (const cycleCount of [1, 3]) {
    const { root, original } = await fixture();
    const humanSection = '## Humana\n\nTexto humano preservado.\n\nLinha extra.\n';
    let current = original.replace('## Humana\n\nTexto original.\n', humanSection);
    await commit(root, current, true);
    for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
      const result = await reconcileHumanUpdate(root, path, original.replace('Produto v1.', `Produto v${cycle + 1}.`));
      assert.equal(result.status, 'update', 'outra seção continua atualizável');
      assert.equal(result.content.slice(result.content.indexOf('## Humana')), humanSection, 'bytes humanos intactos');
      assert.ok(result.content.includes(`Produto v${cycle + 1}.`));
      assert.match(result.notice, /preservad/iu);
      await commit(root, result.content);
      current = result.content;
      const conflict = await reconcileHumanUpdate(root, path, current.replace('Texto humano preservado.', 'Proposta futura do produto.'));
      assert.equal(conflict.status, 'conflict', `proveniência após ${cycle} commit(s) intermediário(s)`);
      assert.equal(conflict.content, null);
      assert.match(conflict.notice, /Texto humano preservado/);
      assert.match(conflict.notice, /Proposta futura do produto/);
      assert.equal(await readFile(join(root, path), 'utf8'), current);
    }
    // Um marcador vindo da proposta não pode descartar o histórico protegido.
    const proposal = current.replace(`Produto v${cycleCount + 1}.`, 'Produto final.')
      .replace(/^mcpGeneratedSha:.*$/m, `mcpGeneratedSha: ${git(root, 'rev-parse', 'HEAD')}`);
    const update = await reconcileHumanUpdate(root, path, proposal);
    assert.equal(update.status, 'update');
    assert.equal(update.content.match(/^mcpGeneratedSha:.*$/m)[0], original.match(/^mcpGeneratedSha:.*$/m)[0]);
    await commit(root, update.content);
    const deletion = await reconcileHumanUpdate(root, path, update.content.replace(humanSection, ''));
    assert.equal(deletion.status, 'conflict', 'remover seção humana também exige decisão');
    assert.match(deletion.notice, /seção removida/);
  }
  {
    const { root, original } = await fixture();
    await commit(root, original.replace('Texto original.', 'Texto humano.'), true);
    // Histórico raso depois de um ciclo também precisa falhar fechado.
    const first = await reconcileHumanUpdate(root, path, original.replace('Produto v1.', 'Produto v2.'));
    assert.equal(first.status, 'update');
    await commit(root, first.content);
    await writeFile(join(root, '.git/shallow'), `${git(root, 'rev-parse', 'HEAD')}\n`);
    const result = await reconcileHumanUpdate(root, path, first.content.replace('Texto humano.', 'Proposta futura.'));
    assert.equal(result.status, 'conflict');
    assert.match(result.notice, /Histórico Git incompleto/);
  }
  {
    const { root, original } = await fixture();
    await commit(root, original.replace('Texto original.', 'Texto humano.'), true);
    const first = await reconcileHumanUpdate(root, path, original.replace('Produto v1.', 'Produto v2.'));
    assert.equal(first.status, 'update');
    await commit(root, first.content);
    // Simula objeto histórico indisponível, mantendo o último blob do bot legível.
    const blob = git(root, 'rev-parse', 'HEAD~2:exemplo.mdx');
    await rm(join(root, '.git/objects', blob.slice(0, 2), blob.slice(2)));
    const result = await reconcileHumanUpdate(root, path, first.content.replace('Texto humano.', 'Proposta futura.'));
    assert.equal(result.status, 'conflict', 'sem conseguir estabelecer proveniência, falha fechada');
    assert.equal(result.content, null);
    assert.match(result.notice, /Histórico Git incompleto/);
  }
  console.log('human edits cycles: ok (automação, preservação, conflito, repetição e histórico indisponível)');
} finally {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  console.log('CLEANUP: OK (fixtures Git próprias)');
}
