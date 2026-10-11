import { lstat, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const realRepo = await realpath(repo);

export function outsideRepo(path) {
  const rel = relative(realRepo, path);
  return rel === '..' || rel.startsWith(`..${sep}`);
}

export async function assertPrivateFile(path, label) {
  if (!outsideRepo(await realpath(dirname(path)))) throw new Error(`${label} deve ficar fora do repo`);
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`${label} não aceita symlink`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
