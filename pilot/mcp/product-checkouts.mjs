import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { productSparseFolders } from './local-product-context.mjs';

const exec = promisify(execFile);
const DEFAULT_REPOSITORIES = Object.freeze({
  front: { url: 'https://github.com/ihelpchat/front-react.git', ref: 'master', role: 'frontend' },
  back: { url: 'https://github.com/ihelpchat/olah-ihelp.git', ref: 'release/validation', role: 'backend' },
});
const SHA = /^[a-f0-9]{40}$/u;

async function git(cwd, token, ...args) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  }
  const { stdout } = await exec('git', args, { cwd, env, timeout: 120_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function shaOf(path) {
  const sha = await git(path, null, 'rev-parse', 'HEAD');
  if (!SHA.test(sha)) throw new Error('SHA inválido');
  return sha;
}

export async function readProductCheckoutState({ stateDir, paths } = {}) {
  const front = paths?.front ?? join(stateDir, 'checkouts/front');
  const back = paths?.back ?? join(stateDir, 'checkouts/back');
  const [frontSha, backSha] = await Promise.all([shaOf(front), shaOf(back)]);
  let updatedAt;
  if (stateDir) {
    try { updatedAt = JSON.parse(await readFile(join(stateDir, 'checkouts/status.json'), 'utf8')).updatedAt; }
    catch { /* externally supplied checkouts have no sync timestamp */ }
  }
  return { front: { sha: frontSha }, back: { sha: backSha }, ...(updatedAt ? { updatedAt } : {}) };
}

export async function syncProductCheckouts({ stateDir, token, now = () => new Date(), repositories = DEFAULT_REPOSITORIES, log = () => {} }) {
  if (!stateDir || !token) throw new Error('Estado ou GITHUB_READ_TOKEN ausente');
  const root = join(stateDir, 'checkouts');
  await mkdir(root, { recursive: true });
  const staged = {};
  const backups = {};
  let active;
  try {
    for (const id of ['front', 'back']) {
      active = id;
      const { url, ref, role } = repositories[id];
      const target = join(root, id);
      const staging = await mkdtemp(join(root, `.${id}-next-`));
      staged[id] = staging;
      if (await stat(join(target, '.git')).catch(() => null)) {
        await cp(target, staging, { recursive: true, force: true });
        await git(staging, token, 'fetch', '--depth', '1', 'origin', ref);
        await git(staging, token, 'checkout', '--detach', 'FETCH_HEAD');
      } else {
        await rm(staging, { recursive: true });
        await git(root, token, 'clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', ref, '--', url, staging);
      }
      await git(staging, token, 'sparse-checkout', 'set', '--', ...productSparseFolders(role));
      await shaOf(staging);
    }
    const result = { front: { sha: await shaOf(staged.front) }, back: { sha: await shaOf(staged.back) }, updatedAt: new Date(now()).toISOString() };
    for (const id of ['front', 'back']) {
      const target = join(root, id);
      if (await stat(target).catch(() => null)) {
        const backup = await mkdtemp(join(root, `.${id}-old-`));
        await rm(backup, { recursive: true });
        await rename(target, backup);
        backups[id] = backup;
      }
      await rename(staged[id], target);
      delete staged[id];
    }
    const statusTemp = join(root, '.status-next.json');
    await writeFile(statusTemp, JSON.stringify(result));
    await rename(statusTemp, join(root, 'status.json'));
    for (const backup of Object.values(backups)) await rm(backup, { recursive: true, force: true }).catch(() => {});
    log('Checkouts do produto atualizados');
    return result;
  } catch {
    for (const id of ['front', 'back']) {
      if (!backups[id]) continue;
      const target = join(root, id);
      await rm(target, { recursive: true, force: true });
      await rename(backups[id], target);
    }
    log(`Sync do produto falhou: ${active ?? 'estado'}`);
    throw new Error(`Sync do produto falhou: ${active ?? 'estado'}`);
  } finally {
    for (const path of Object.values(staged)) await rm(path, { recursive: true, force: true });
  }
}
