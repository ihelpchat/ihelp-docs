import { lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const BLOCKED_PART = /connectionstring|secret|credential|password|appsettings|\.env|keyvault|certificate/iu;
const BLOCKED_DIR = /(?:^|\/)(?:bin|obj|tests?|__tests__|[^/]*tests?)(?:\/|$)/iu;

export function canReadBackFile(relativePath) {
  return typeof relativePath === 'string'
    && !relativePath.startsWith('/')
    && !relativePath.includes('\\')
    && !relativePath.split('/').some((part) => !part || part === '.' || part === '..')
    && relativePath.toLowerCase().endsWith('.cs')
    && !BLOCKED_DIR.test(relativePath)
    && !BLOCKED_PART.test(relativePath);
}

function backPath(root, relativePath) {
  if (!canReadBackFile(relativePath)) throw new Error('Arquivo do back não permitido');
  return join(root, relativePath);
}

export async function statBackFile(root, relativePath, stat = lstat) {
  return stat(backPath(root, relativePath));
}

export async function readBackFile(root, relativePath, reader, options) {
  return reader(backPath(root, relativePath), options);
}

export async function safeRead(path, { signal }) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile({ encoding: 'utf8', signal }); }
  finally { await handle.close(); }
}
