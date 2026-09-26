import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const pending = new Map();
export function serialize(file, operation) {
  const previous = pending.get(file) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  pending.set(file, current);
  void current.finally(() => { if (pending.get(file) === current) pending.delete(file); }).catch(() => {});
  return current;
}

export async function appendJsonl(file, event) {
  return serialize(file, async () => {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  });
}

export async function readJsonl(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function replaceJsonl(file, events) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''), { mode: 0o600 });
  await rename(temporary, file);
}
