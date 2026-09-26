import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isPublishedPath } from './published-paths.mjs';

const validTypes = new Set(['assistant', 'article']);
const validValues = new Set(['up', 'down']);

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function localPath(value) {
  return /^\/(?!\/)[a-z0-9/_-]*$/iu.test(value);
}

export function normalizeFeedback(input) {
  const type = clean(input?.type, 20);
  const value = clean(input?.value, 10);
  const path = clean(input?.path, 300);
  if (!validTypes.has(type) || !validValues.has(value) || !localPath(path)
    || (input?.eventId !== undefined && !/^[a-z0-9-]{3,100}$/iu.test(input.eventId))
    || (input?.sources !== undefined && (!Array.isArray(input.sources)
      || input.sources.some((source) => !localPath(source))))) {
    throw new Error('Feedback inválido.');
  }

  return {
    id: clean(input.eventId, 100) || crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type,
    value,
    path: isPublishedPath(path) ? path : null,
    // Keep the vote and source paths only. Free text is not needed for metrics.
    sources: Array.isArray(input.sources)
      ? input.sources.filter(isPublishedPath).slice(0, 4)
      : [],
  };
}

export async function saveFeedback(file, input, request) {
  const event = normalizeFeedback(input, request);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return event;
}

export async function summarizeFeedback(file) {
  let raw = '';
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const recorded = raw.split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  // O mesmo voto pode ser alterado; para as métricas vale somente a versão mais recente do evento.
  const events = [...new Map(recorded.map((event) => [event.id, event])).values()];
  const byType = { assistant: { up: 0, down: 0 }, article: { up: 0, down: 0 } };
  const byPath = new Map();
  for (const event of events) {
    if (byType[event.type]?.[event.value] !== undefined) byType[event.type][event.value] += 1;
    const entry = byPath.get(event.path) ?? { path: event.path, up: 0, down: 0 };
    if (entry[event.value] !== undefined) entry[event.value] += 1;
    byPath.set(event.path, entry);
  }
  return {
    total: events.length,
    positiveRate: events.length ? Number(((events.filter((event) => event.value === 'up').length / events.length) * 100).toFixed(1)) : 0,
    byType,
    byPath: [...byPath.values()].sort((left, right) => (right.up + right.down) - (left.up + left.down)),
  };
}
