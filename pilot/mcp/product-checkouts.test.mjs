import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { productSparseFolders } = await import('./local-product-context.mjs');
const { productCheckoutRefreshHours } = await import('./env-compat.mjs');
const { syncProductCheckouts } = await import('./product-checkouts.mjs').catch(() => ({}));

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

await test('sync esparso, token fora do config/log e SHA preservado na falha', async () => {
  assert.equal(typeof productSparseFolders, 'function', 'leitor precisa exportar as pastas sparse');
  assert.equal(typeof syncProductCheckouts, 'function', 'módulo de sync precisa existir');
  const implementation = await readFile(new URL('./product-checkouts.mjs', import.meta.url), 'utf8');
  assert.match(implementation, /productSparseFolders\(role\)/u, 'lista sparse deve vir do leitor');
  const root = await mkdtemp(join(tmpdir(), 'm553-'));
  try {
    const repositories = {};
    for (const [id, role, ref] of [['front', 'frontend', 'master'], ['back', 'backend', 'release/validation']]) {
      const bare = join(root, `${id}.git`);
      const work = join(root, `${id}-source`);
      await mkdir(work);
      git(root, 'init', '--bare', bare);
      git(work, 'init');
      git(work, 'checkout', '-b', ref);
      for (const folder of productSparseFolders(role)) {
        await mkdir(join(work, folder), { recursive: true });
        await writeFile(join(work, folder, 'sample.cs'), `${id}: ${folder}`);
      }
      await mkdir(join(work, 'unrelated'));
      await writeFile(join(work, 'unrelated/outside.txt'), 'outside sparse');
      git(work, 'add', '.');
      git(work, 'commit', '-m', 'fixture');
      git(work, 'remote', 'add', 'origin', bare);
      git(work, 'push', '-u', 'origin', ref);
      repositories[id] = { url: bare, ref, role };
    }
    const stateDir = join(root, 'state');
    const token = 'M553_TOKEN_FIXTURE_123';
    const logs = [];
    const first = await syncProductCheckouts({ stateDir, token, repositories, now: () => new Date('2026-09-26T12:00:00Z'), log: (line) => logs.push(line) });
    assert.match(first.front.sha, /^[a-f0-9]{40}$/u);
    assert.match(first.back.sha, /^[a-f0-9]{40}$/u);
    assert.equal(first.updatedAt, '2026-09-26T12:00:00.000Z');
    for (const [id, role] of [['front', 'frontend'], ['back', 'backend']]) {
      const checkout = join(stateDir, 'checkouts', id);
      assert.deepEqual(git(checkout, 'sparse-checkout', 'list').split('\n').sort(), [...productSparseFolders(role)].sort());
      assert.equal(git(checkout, 'rev-parse', 'HEAD'), first[id].sha);
      assert.doesNotMatch(await readFile(join(checkout, '.git/config'), 'utf8'), /M553_TOKEN_FIXTURE_123/u);
      await assert.rejects(readFile(join(checkout, 'unrelated/outside.txt')));
    }
    assert.doesNotMatch(logs.join('\n'), /M553_TOKEN_FIXTURE_123/u);
    await writeFile(join(root, 'front-source/src/pages/new.tsx'), 'new upstream version');
    git(join(root, 'front-source'), 'add', '.');
    git(join(root, 'front-source'), 'commit', '-m', 'next version');
    git(join(root, 'front-source'), 'push', 'origin', 'master');
    const second = await syncProductCheckouts({ stateDir, token, repositories });
    assert.notEqual(second.front.sha, first.front.sha, 'fetch traz o ref novo');
    assert.equal(second.back.sha, first.back.sha);
    await writeFile(join(root, 'front-source/src/pages/new.tsx'), 'third upstream version');
    git(join(root, 'front-source'), 'add', '.');
    git(join(root, 'front-source'), 'commit', '-m', 'third version');
    git(join(root, 'front-source'), 'push', 'origin', 'master');
    await rm(repositories.back.url, { recursive: true });
    await assert.rejects(syncProductCheckouts({ stateDir, token, repositories, log: (line) => logs.push(line) }),
      /Sync do produto falhou: back/u);
    assert.equal(git(join(stateDir, 'checkouts/front'), 'rev-parse', 'HEAD'), second.front.sha);
    assert.equal(git(join(stateDir, 'checkouts/back'), 'rev-parse', 'HEAD'), second.back.sha);
    assert.doesNotMatch(logs.join('\n'), /M553_TOKEN_FIXTURE_123/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('intervalo de refresh usa 36 h e rejeita valor inválido', () => {
  assert.equal(typeof productCheckoutRefreshHours, 'function', 'intervalo precisa estar no env-compat');
  assert.equal(productCheckoutRefreshHours({}), 36);
  assert.equal(productCheckoutRefreshHours({ PRODUCT_CHECKOUT_REFRESH_HOURS: '12' }), 12);
  assert.throws(() => productCheckoutRefreshHours({ PRODUCT_CHECKOUT_REFRESH_HOURS: '0' }),
    /PRODUCT_CHECKOUT_REFRESH_HOURS inválido/u);
});
