import { appendJsonl, readJsonl, replaceJsonl, serialize } from './jsonl-store.mjs';

const DAY_MS = 24 * 60 * 60_000;
const outcomes = ['complete', 'partial', 'not_found', 'escalated', 'abandoned'];
export const ABANDONED_AFTER_MS = 30 * 60_000;
const unresolved = new Set(['partial', 'not_found', 'escalated', 'abandoned']);

export async function saveConversation(file, input) {
  const row = { ...input };
  if (row.origin !== 'app' || !Number.isSafeInteger(row.companyId) || row.companyId <= 0) delete row.companyId;
  await appendJsonl(file, row);
  return row;
}

export const listConversations = readJsonl;

export async function pruneConversations(file, { now = Date.now(), retentionDays } = {}) {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) throw new Error('Retenção inválida.');
  return serialize(file, async () => {
    const rows = await readJsonl(file);
    const kept = rows.filter((row) => Date.parse(row.at) >= now - retentionDays * DAY_MS);
    if (kept.length !== rows.length) await replaceJsonl(file, kept);
    return rows.length - kept.length;
  });
}

function percent(part, total) { return total ? Math.round(part * 1000 / total) / 10 : 0; }

export function summarizeConversations(rows, filters = {}, { now = Date.now() } = {}) {
  const { from, to, origin, companyId, resolution } = filters;
  const scoped = rows.filter((row) => {
    const date = typeof row.at === 'string' ? row.at.slice(0, 10) : '';
    return (!from || date >= from) && (!to || date <= to)
      && (!origin || row.origin === origin)
      && (!companyId || row.companyId === Number(companyId));
  });
  const sessions = new Map();
  scoped.forEach((row, index) => {
    const key = row.sessionId ?? `row-${index}`;
    const session = sessions.get(key) ?? [];
    session.push(row);
    sessions.set(key, session);
  });
  const allConversations = [...sessions.values()].map((session) => ({
    rows: session, row: session.reduce((latest, row) => Date.parse(row.at) >= Date.parse(latest.at) ? row : latest),
  }));
  const category = ({ rows: session, row }) => {
    if (session.some((entry) => entry.offeredHuman || entry.resolution === 'escalated')) return 'escalated';
    if (row.resolution === 'complete') return 'complete';
    if (row.resolution === 'abandoned' ||
      (['in_progress', 'partial'].includes(row.resolution) && !row.offeredHuman &&
        now - Date.parse(row.at) > ABANDONED_AFTER_MS)) return 'abandoned';
    if (row.resolution === 'not_found') return 'not_found';
    return 'partial';
  };
  const conversations = resolution ? allConversations.filter((conversation) => category(conversation) === resolution) : allConversations;
  const selected = conversations.flatMap((conversation) => conversation.rows);
  const total = selected.length;
  const counts = outcomes.map((key) => conversations.filter((conversation) => category(conversation) === key).length);
  const units = counts.map((count) => conversations.length ? Math.floor(count * 1000 / conversations.length) : 0);
  let remainder = conversations.length ? 1000 - units.reduce((sum, value) => sum + value, 0) : 0;
  const order = counts.map((count, index) => ({ index, fraction: conversations.length ? count * 1000 / conversations.length - units[index] : 0 }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index++) units[order[index].index]++;
  const percentages = Object.fromEntries(outcomes.map((key, index) => [key, units[index] / 10]));
  const grouped = (key) => {
    const map = new Map();
    for (const row of selected) {
      if (row[key] === undefined) continue;
      const id = key === 'topic' ? `${row.topic ?? 'Outro'} / ${row.action ?? 'Outro'}` : row[key];
      const group = map.get(id) ?? { [key]: id, total: 0, resolved: 0 };
      group.total++;
      if (row.resolution === 'complete') group.resolved++;
      map.set(id, group);
    }
    return [...map.values()].map(({ resolved, ...rest }) => ({ ...rest, resolvedPercent: percent(resolved, rest.total) }))
      .sort((a, b) => b.total - a.total || String(a[key]).localeCompare(String(b[key])));
  };
  const byTopic = grouped('topic');
  const noTopic = selected.filter((row) => !row.topic);
  if (noTopic.length) byTopic.push({ topic: 'Outro / Outro', total: noTopic.length,
    resolvedPercent: percent(noTopic.filter((row) => row.resolution === 'complete').length, noTopic.length) });
  const page = Number.isSafeInteger(Number(filters.page)) && Number(filters.page) > 0 ? Number(filters.page) : 1;
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 20));
  const unanswered = conversations.filter((conversation) => unresolved.has(category(conversation))).map(({ row }) => row)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { total, sessionTotal: conversations.length, percentages, byTopic, byCompany: grouped('companyId'),
    unresolvedTotal: unanswered.length, page, pageSize,
    unresolved: unanswered.slice((page - 1) * pageSize, page * pageSize) };
}
