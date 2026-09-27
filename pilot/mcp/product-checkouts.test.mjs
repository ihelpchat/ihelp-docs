import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { productSparseFolders } = await import('./local-product-context.mjs');
const { productCheckoutRefreshHours } = await import('./env-compat.mjs');
const { syncProductCheckouts, initializeProductCheckouts } = await import('./product-checkouts.mjs').catch(() => ({}));
const { searchLocalProductContext } = await import('./local-product-context.mjs');
const { planContent } = await import('./content-ai-service.mjs');
const { getIhelpContext } = await import('./product-context-service.mjs');

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
    assert.match(await readlink(join(stateDir, 'checkouts/current')), /^gen-/u, 'par publicado por um único symlink');
    for (const [id, role] of [['front', 'frontend'], ['back', 'backend']]) {
      const checkout = join(stateDir, 'checkouts/current', id);
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
    assert.equal(git(join(stateDir, 'checkouts/current/front'), 'rev-parse', 'HEAD'), second.front.sha);
    assert.equal(git(join(stateDir, 'checkouts/current/back'), 'rev-parse', 'HEAD'), second.back.sha);
    await writeFile(join(root, 'front-source/src/pages/new.tsx'), 'third upstream version');
    git(join(root, 'front-source'), 'add', '.');
    git(join(root, 'front-source'), 'commit', '-m', 'third version');
    git(join(root, 'front-source'), 'push', 'origin', 'master');
    await rm(repositories.back.url, { recursive: true });
    await assert.rejects(syncProductCheckouts({ stateDir, token, repositories, log: (line) => logs.push(line) }),
      /Sync do produto falhou: back/u);
    assert.equal(git(join(stateDir, 'checkouts/current/front'), 'rev-parse', 'HEAD'), second.front.sha);
    assert.equal(git(join(stateDir, 'checkouts/current/back'), 'rev-parse', 'HEAD'), second.back.sha);
    assert.doesNotMatch(logs.join('\n'), /M553_TOKEN_FIXTURE_123/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

await test('boot publica checkout para planContent e leitura fixa o par durante sync', async () => {
  assert.equal(typeof initializeProductCheckouts, 'function', 'boot deve usar inicialização testável');
  const root = await mkdtemp(join(tmpdir(), 'm553-generation-'));
  const previous = { front: process.env.PRODUCT_LOCAL_CHECKOUT, back: process.env.BACKEND_LOCAL_CHECKOUT };
  try {
    const repositories = {};
    for (const [id, role, ref, file, word] of [
      ['front', 'frontend', 'master', 'src/pages/Widget.tsx', 'widget'],
      ['back', 'backend', 'release/validation', 'Controllers/ChannelController.cs', 'canal'],
    ]) {
      const bare = join(root, `${id}.git`);
      const work = join(root, `${id}-source`);
      await mkdir(work);
      git(root, 'init', '--bare', bare);
      git(work, 'init');
      git(work, 'checkout', '-b', ref);
      await mkdir(join(work, file.split('/').slice(0, -1).join('/')), { recursive: true });
      await writeFile(join(work, file), `export const ${word} = 'produto ${word} old';`);
      git(work, 'add', '.'); git(work, 'commit', '-m', 'old');
      git(work, 'remote', 'add', 'origin', bare); git(work, 'push', 'origin', ref);
      repositories[id] = { url: bare, ref, role, work, file, word };
    }
    const stateDir = join(root, 'state');
    const boot = await initializeProductCheckouts({ stateDir, token: 'fixture-token', repositories });
    assert.equal(boot.front.sha, git(join(stateDir, 'checkouts/current/front'), 'rev-parse', 'HEAD'));
    assert.equal(process.env.PRODUCT_LOCAL_CHECKOUT, join(stateDir, 'checkouts/current/front'));
    assert.equal(process.env.BACKEND_LOCAL_CHECKOUT, join(stateDir, 'checkouts/current/back'));
    for (const [topic, expected] of [['widget', 'src/pages/Widget.tsx'], ['canal', 'Controllers/ChannelController.cs']]) {
      const context = await getIhelpContext(new URL('../', import.meta.url).pathname, topic, 'produto', { requireLocal: true, cache: false });
      const match = context.matches.find((item) => item.path === expected);
      assert.ok(match, `match ausente: ${expected}`);
      const client = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
        status: 'ready', guidance: 'Abra a tela.', questions: [], risks: [], suggestedActions: [],
        grounding: [{ text: 'Abra a tela.', citations: [{ repository: match.repository, path: match.path,
          lineStart: match.line, lineEnd: match.line, sha: match.sha }] }],
      }) }) } };
      const plan = await planContent(new URL('../', import.meta.url).pathname,
        { topic, module: 'produto', description: `Documentar ${topic}` }, { client, contextOptions: { cache: false } });
      assert.notEqual(plan.status, 'needs_information', `planContent precisa acessar ${expected}`);
      assert.ok(plan.productContext.files.some((file) => file.includes(expected)), `match ausente: ${expected}`);
    }
    const oldRoot = await realpath(join(stateDir, 'checkouts/current'));
    for (const id of ['front', 'back']) {
      const { work, file, word, ref } = repositories[id];
      await writeFile(join(work, file), `export const ${word} = 'produto ${word} new';`);
      git(work, 'add', '.'); git(work, 'commit', '-m', 'new'); git(work, 'push', 'origin', ref);
    }
    let changed = false;
    const old = await searchLocalProductContext('produto', 'produto', { cache: false, readFile: async (path, options) => {
      if (!changed) {
        changed = true;
        await syncProductCheckouts({ stateDir, token: 'fixture-token', repositories });
      }
      return readFile(path, options);
    } });
    assert.equal(changed, true, 'leitor deve atravessar o ponto de troca');
    assert.equal(old.code[0].ref, boot.front.sha);
    assert.equal(old.code[1].ref, boot.back.sha);
    assert.ok(old.matches.some((match) => match.path === repositories.front.file));
    assert.ok(old.matches.some((match) => match.path === repositories.back.file), JSON.stringify(old.code));
    assert.notEqual(await realpath(join(stateDir, 'checkouts/current')), oldRoot);
    const next = await searchLocalProductContext('produto', 'produto', { cache: false });
    assert.notEqual(next.code[0].ref, old.code[0].ref);
    assert.notEqual(next.code[1].ref, old.code[1].ref);
    const secondRoot = await realpath(join(stateDir, 'checkouts/current'));
    await syncProductCheckouts({ stateDir, token: 'fixture-token', repositories });
    await assert.rejects(realpath(oldRoot), 'geração anterior à última deve ser removida');
    assert.equal(await realpath(secondRoot), secondRoot, 'geração anterior deve permanecer');
  } finally {
    if (previous.front === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
    else process.env.PRODUCT_LOCAL_CHECKOUT = previous.front;
    if (previous.back === undefined) delete process.env.BACKEND_LOCAL_CHECKOUT;
    else process.env.BACKEND_LOCAL_CHECKOUT = previous.back;
    await rm(root, { recursive: true, force: true });
  }
});

await test('intervalo de refresh usa 36 h e rejeita valor inválido', () => {
  assert.equal(typeof productCheckoutRefreshHours, 'function', 'intervalo precisa estar no env-compat');
  assert.equal(productCheckoutRefreshHours({}), 36);
  assert.equal(productCheckoutRefreshHours({ PRODUCT_CHECKOUT_REFRESH_HOURS: '12' }), 12);
  assert.throws(() => productCheckoutRefreshHours({ PRODUCT_CHECKOUT_REFRESH_HOURS: '0' }),
    /PRODUCT_CHECKOUT_REFRESH_HOURS inválido/u);
});
