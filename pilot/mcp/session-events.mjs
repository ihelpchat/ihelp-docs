import { appendJsonl, readJsonl, replaceJsonl, serialize } from './jsonl-store.mjs';
import guideIds from '../architecture/guide-ids.json' with { type: 'json' };
import productActions from '../architecture/product-actions.json' with { type: 'json' };
import { isPublishedPath } from './published-paths.mjs';
import { z } from 'zod/v4';
import { PROCEDURE_ACTIONS } from './gap-classification.mjs';

const DAY_MS = 24 * 60 * 60_000;
const ID = /^[a-z0-9][a-z0-9-]{2,63}$/iu;
const PATH = /^\/(?!\/)[a-z0-9/_-]*$/iu;
const ORIGINS = new Set(['faq', 'app']);
const GUIDE_IDS = new Set(guideIds);
const RESULTS = new Set(['complete', 'partial', 'not_found', 'in_progress', 'escalated', 'abandoned']);
const TOPICS = new Set([...Object.keys(productActions), ...Object.values(productActions).map(({ route }) => route)]);
const ISSUES = new Set(['usage', 'incident', 'permission', 'account_state', 'unknown']);
export const sessionEventSchema = z.object({
  sessionId: z.string().regex(ID),
  origin: z.enum(['faq', 'app']),
  guideId: z.string().optional(),
  stepId: z.string().regex(ID).optional(),
  durationMs: z.number().int().min(0).max(300_000),
  result: z.enum([...RESULTS]),
  topic: z.enum([...TOPICS]).optional(),
  action: z.enum(PROCEDURE_ACTIONS).optional(),
  issue: z.enum([...ISSUES]).optional(),
  path: z.string().regex(PATH),
  createdAt: z.string().optional(),
}).strict();
const FIELDS = new Set(Object.keys(sessionEventSchema.shape));

function invalid() { throw new Error('Evento inválido.'); }


export function normalizeSessionEvent(input, { now = Date.now() } = {}) {
  const safeInput = input && typeof input === 'object' && !Array.isArray(input)
    ? { ...input,
      ...(input.topic !== undefined && !TOPICS.has(input.topic) ? { topic: undefined } : {}),
      ...(input.action !== undefined && !PROCEDURE_ACTIONS.includes(input.action) ? { action: undefined } : {}) }
    : input;
  if (!sessionEventSchema.safeParse(safeInput).success
    || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !FIELDS.has(key))
    || !ID.test(input.sessionId ?? '') || !ORIGINS.has(input.origin)
    || (input.guideId !== undefined && !GUIDE_IDS.has(input.guideId))
    || (input.stepId !== undefined && !ID.test(input.stepId))
    || !Number.isInteger(input.durationMs) || input.durationMs < 0 || input.durationMs > 300_000
    || !RESULTS.has(input.result) || !PATH.test(input.path ?? '')) invalid();
  const createdAt = input.createdAt ?? new Date(now).toISOString();
  if (typeof createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(createdAt)
    || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt
    || Date.parse(createdAt) > now + 60_000) invalid();
  return {
    sessionId: input.sessionId,
    origin: input.origin,
    ...(input.guideId === undefined ? {} : { guideId: input.guideId }),
    ...(input.stepId === undefined ? {} : { stepId: input.stepId }),
    durationMs: input.durationMs,
    result: input.result,
    ...(TOPICS.has(input.topic) ? { topic: input.topic } : {}),
    ...(PROCEDURE_ACTIONS.includes(input.action) ? { action: input.action } : {}),
    ...(input.issue === undefined ? {} : { issue: input.issue }),
    path: isPublishedPath(input.path) ? input.path : null,
    createdAt,
  };
}

export async function saveSessionEvent(file, input, options = {}) {
  const event = normalizeSessionEvent(input, options);
  await appendJsonl(file, event);
  return event;
}

export async function pruneSessionEvents(file, { now = Date.now(), retentionDays = 30 } = {}) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) invalid();
  return serialize(file, async () => {
    const events = await readJsonl(file);
    const kept = events.filter((event) => Number.isFinite(Date.parse(event.createdAt))
      && Date.parse(event.createdAt) >= now - retentionDays * DAY_MS);
    if (kept.length !== events.length) await replaceJsonl(file, kept);
    return events.length - kept.length;
  });
}

export async function discardSessionEvents(file, sessionId) {
  if (!ID.test(sessionId ?? '')) invalid();
  return serialize(file, async () => {
    const events = await readJsonl(file);
    const kept = events.filter((event) => event.sessionId !== sessionId);
    if (kept.length !== events.length) await replaceJsonl(file, kept);
    return events.length - kept.length;
  });
}
