import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { containsSensitiveData } from './sensitive-data.mjs';
import { loadBusinessContext } from './faq-editorial.mjs';
import { safeSyncError } from './sync-diagnostics.mjs';

const exec = promisify(execFile);
const SOURCE = 'https://github.com/ihelpchat/second-brain-ihelp.git';
const SUBDIR = 'produto/contexto-faq';
const FILE = /^[a-z0-9][a-z0-9-]*\.md$/u;
const HEADER = /^>\s*🟢\s+(?:\*\*)?PÚBLICO(?:\*\*)?(?:\s+—\s+.+)?\s*$/u;

export function convertBusinessContext(name, source) {
  const lines = source.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  const title = lines.shift() ?? '';
  while (lines.length && !lines[0].trim()) lines.shift();
  const header = lines.shift() ?? '';
  if (!FILE.test(name) || !/^# \S/u.test(title) || !HEADER.test(header)) return null;
  while (lines.length && !lines[0].trim()) lines.shift();
  const body = `🟢 PÚBLICO\n\n${title}\n\n${lines.join('\n')}`;
  if (/🟡|🔴|\b(?:INTERNO|CONFIDENCIAL)\b/iu.test(body)
    || containsSensitiveData(body, { detectOpaque: true })) return null;
  return body;
}

export async function syncBusinessContext({ stateDir, token, sourceDir, log = () => {} }) {
  if (!token && !sourceDir) return { status: 'pending', reason: 'GITHUB_READ_TOKEN ausente' };
  const root = join(stateDir, 'business-context');
  await mkdir(root, { recursive: true });
  const generation = await mkdtemp(join(root, 'gen-'));
  const current = join(root, 'current');
  const temporaryLink = join(root, 'current.tmp');
  let clone;
  let published = false;
  let stage = 'criar geração';
  try {
    let source = sourceDir;
    if (!source) {
      clone = await mkdtemp(join(tmpdir(), 'faq-business-source-'));
      const target = join(clone, 'brain');
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` };
      stage = 'clone';
      await exec('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--', SOURCE, target],
        { env, timeout: 120_000, maxBuffer: 1024 * 1024 });
      stage = 'sparse-checkout';
      await exec('git', ['sparse-checkout', 'set', '--', SUBDIR],
        { cwd: target, env, timeout: 120_000, maxBuffer: 1024 * 1024 });
      source = join(target, SUBDIR);
    }
    const skipped = [];
    let copied = 0;
    stage = 'ler contexto';
    for (const name of (await readdir(source)).filter((item) => FILE.test(item)).sort()) {
      const body = convertBusinessContext(name, await readFile(join(source, name), 'utf8'));
      if (!body) { skipped.push(name); continue; }
      await writeFile(join(generation, name), body, { mode: 0o600 });
      copied += 1;
    }
    if (!copied || !((await loadBusinessContext('', undefined, generation))
      .some((item) => item.path === 'business-context/geral.md'))) {
      throw new Error('Contexto privado indisponível');
    }
    const previous = await readlink(current).catch(() => null);
    stage = 'symlink';
    await rm(temporaryLink, { force: true });
    await symlink(basename(generation), temporaryLink, 'dir');
    await rename(temporaryLink, current);
    published = true;
    for (const name of await readdir(root)) {
      if (name.startsWith('gen-') && name !== basename(generation) && name !== previous)
        await rm(join(root, name), { recursive: true, force: true }).catch(() => {});
    }
    if (skipped.length) log(`Contexto ignorado: ${skipped.join(', ')}`);
    return { status: 'available', directory: current, copied, skipped };
  } catch (error) {
    log(`Sync do contexto falhou: second-brain ${stage}: ${safeSyncError(error, token)}`);
    throw error;
  } finally {
    await rm(temporaryLink, { force: true }).catch(() => {});
    if (!published) await rm(generation, { recursive: true, force: true });
    if (clone) await rm(clone, { recursive: true, force: true });
  }
}
