import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
  const generation = paths ? null : await realpath(join(stateDir, 'checkouts/current'));
  const front = paths?.front ?? join(generation, 'front');
  const back = paths?.back ?? join(generation, 'back');
  const [frontSha, backSha] = await Promise.all([shaOf(front), shaOf(back)]);
  let updatedAt;
  if (generation) {
    const status = JSON.parse(await readFile(join(generation, 'status.json'), 'utf8'));
    if (status.front?.sha !== frontSha || status.back?.sha !== backSha
      || typeof status.updatedAt !== 'string' || !Number.isFinite(Date.parse(status.updatedAt))) {
      throw new Error('status da geração inválido');
    }
    updatedAt = status.updatedAt;
  }
  return { front: { sha: frontSha }, back: { sha: backSha }, ...(updatedAt ? { updatedAt } : {}) };
}

export async function syncProductCheckouts({ stateDir, token, now = () => new Date(), repositories = DEFAULT_REPOSITORIES, log = () => {} }) {
  if (!stateDir || !token) throw new Error('Estado ou GITHUB_READ_TOKEN ausente');
  const root = join(stateDir, 'checkouts');
  await mkdir(root, { recursive: true });
  const generation = await mkdtemp(join(root, `gen-${Date.now()}-`));
  const current = join(root, 'current');
  const temporaryLink = join(root, 'current.tmp');
  let active;
  let published = false;
  try {
    for (const id of ['front', 'back']) {
      active = id;
      const { url, ref, role } = repositories[id];
      const target = join(generation, id);
      await git(root, token, 'clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', ref, '--', url, target);
      await git(target, token, 'sparse-checkout', 'set', '--', ...productSparseFolders(role));
      await shaOf(target);
    }
    const result = { front: { sha: await shaOf(join(generation, 'front')) }, back: { sha: await shaOf(join(generation, 'back')) }, updatedAt: new Date(now()).toISOString() };
    await writeFile(join(generation, 'status.json'), JSON.stringify(result));
    const previous = await readlink(current).catch(() => null);
    await rm(temporaryLink, { force: true });
    await symlink(basename(generation), temporaryLink, 'dir');
    await rename(temporaryLink, current);
    published = true;
    // The previous generation stays intact for readers that pinned it before publication.
    for (const entry of await readdir(root)) {
      if (entry.startsWith('gen-') && entry !== basename(generation) && entry !== previous) {
        await rm(join(root, entry), { recursive: true, force: true }).catch(() => {});
      }
    }
    log('Checkouts do produto atualizados');
    return result;
  } catch {
    log(`Sync do produto falhou: ${active ?? 'estado'}`);
    throw new Error(`Sync do produto falhou: ${active ?? 'estado'}`);
  } finally {
    await rm(temporaryLink, { force: true }).catch(() => {});
    if (!published) await rm(generation, { recursive: true, force: true });
  }
}

export async function restoreProductCheckouts(stateDir) {
  const result = await readProductCheckoutState({ stateDir });
  process.env.PRODUCT_LOCAL_CHECKOUT = join(stateDir, 'checkouts/current/front');
  process.env.BACKEND_LOCAL_CHECKOUT = join(stateDir, 'checkouts/current/back');
  return result;
}

export async function initializeProductCheckouts(options) {
  const { stateDir } = options;
  try { await restoreProductCheckouts(stateDir); }
  catch { /* first sync has no valid current generation */ }
  const result = await syncProductCheckouts(options);
  await restoreProductCheckouts(stateDir);
  return result;
}
