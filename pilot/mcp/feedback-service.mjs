import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const validTypes = new Set(['assistant', 'article']);
const validValues = new Set(['up', 'down']);

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeFeedback(input, request = {}) {
  const type = clean(input?.type, 20);
  const value = clean(input?.value, 10);
  const path = clean(input?.path, 300);
  if (!validTypes.has(type) || !validValues.has(value) || !path.startsWith('/')) {
    throw new Error('Feedback inválido.');
  }

  return {
    id: clean(input.eventId, 100) || crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    type,
    value,
    path,
    question: clean(input.question, 500) || undefined,
    sources: Array.isArray(input.sources)
      ? input.sources.map((source) => clean(source, 300)).filter((source) => source.startsWith('/')).slice(0, 4)
      : [],
    userAgent: clean(request.userAgent, 300) || undefined,
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
