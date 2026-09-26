import { appendJsonl, readJsonl, replaceJsonl, serialize } from './jsonl-store.mjs';

const DAY_MS = 24 * 60 * 60_000;
const outcomes = ['complete', 'partial', 'not_found', 'escalated', 'abandoned'];
const unresolved = new Set(['partial', 'not_found', 'escalated']);

export async function saveConversation(file, input) {
  const row = { ...input };
  if (row.origin !== 'app' || !Number.isSafeInteger(row.companyId) || row.companyId <= 0) delete row.companyId;
  await appendJsonl(file, row);
  return row;
}

export const listConversations = readJsonl;

export async function pruneConversations(file, { now = Date.now(), retentionDays } = {}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('Retenção inválida.');
  return serialize(file, async () => {
    const rows = await readJsonl(file);
    const kept = rows.filter((row) => Date.parse(row.at) >= now - retentionDays * DAY_MS);
    if (kept.length !== rows.length) await replaceJsonl(file, kept);
    return rows.length - kept.length;
  });
}

function percent(part, total) { return total ? Math.round(part * 1000 / total) / 10 : 0; }

export function summarizeConversations(rows, filters = {}) {
  const { from, to, origin, companyId, resolution } = filters;
  const selected = rows.filter((row) => {
    const date = typeof row.at === 'string' ? row.at.slice(0, 10) : '';
    return (!from || date >= from) && (!to || date <= to)
      && (!origin || row.origin === origin)
      && (!companyId || row.companyId === Number(companyId))
      && (!resolution || row.resolution === resolution);
  });
  const total = selected.length;
  const percentages = Object.fromEntries(outcomes.map((key) => [key, percent(selected.filter((row) => row.resolution === key).length, total)]));
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
  const unanswered = selected.filter((row) => unresolved.has(row.resolution))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { total, percentages, byTopic, byCompany: grouped('companyId'),
    unresolvedTotal: unanswered.length, page, pageSize,
    unresolved: unanswered.slice((page - 1) * pageSize, page * pageSize) };
}
