import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion } from './assistant-service.mjs';
import { normalizeFeedback, saveFeedback } from './feedback-service.mjs';
import { normalizeSessionEvent, saveSessionEvent, pruneSessionEvents, discardSessionEvents } from './session-events.mjs';

const root = new URL('../', import.meta.url).pathname;
const tmp = await mkdtemp(join(tmpdir(), 'claricia-minimization-'));
const email = 'sentinela@example.test';
const token = 'sk-proj-FAKESECRET012345678901234567890';
let captured;
const client = { responses: { create: async (request) => {
  captured = JSON.stringify(request.input);
  return { model: 'fixture', output_text: JSON.stringify({
    answer: 'Abra Campanhas.', sections: [], steps: [], code: null,
    sources: [], suggestions: [], resolution: 'complete', found: true,
  }) };
} } };
await answerQuestion(root, `Como criar campanha? ${email} ${token}`, {
  client,
  history: [{ role: 'user', content: `Meu email é ${email} e token ${token}` }],
  page: { path: '/docs/campanhas', title: `Ajuda ${email}` },
});
assert.ok(captured, 'a consulta deve chegar ao provider simulado');
assert.doesNotMatch(captured, /sentinela@example\.test|FAKESECRET012345678901234567890/);
assert.match(captured, /\[dado removido\]|\[segredo removido\]/);

const feedbackFile = join(tmp, 'feedback.jsonl');
const feedback = await saveFeedback(feedbackFile, {
  eventId: 'fixture-1', type: 'assistant', value: 'up', path: '/assistente',
  question: `Meu email ${email}, token ${token}`,
  sources: ['/docs/campanhas'],
}, { userAgent: `Fixture ${email}` });
const recordedFeedback = await readFile(feedbackFile, 'utf8');
assert.doesNotMatch(recordedFeedback, /sentinela@example\.test|FAKESECRET012345678901234567890/);
assert.equal(feedback.question, undefined, 'texto da conversa não é persistido por padrão');
assert.equal(feedback.userAgent, undefined, 'user agent livre não é necessário à métrica');
assert.throws(() => normalizeFeedback({ type: 'assistant', value: 'up', path: '/assistente?token=fake' }), /Feedback inválido/);

const event = {
  sessionId: 'fixture-session-1', origin: 'faq', guideId: 'reconectar-canal-qr',
  stepId: 'abrir-canais', durationMs: 1234, result: 'complete', path: '/docs/canais',
};
const normalized = normalizeSessionEvent(event);
assert.deepEqual(Object.keys(normalized).sort(), ['createdAt', 'durationMs', 'guideId', 'origin', 'path', 'result', 'sessionId', 'stepId'].sort());
for (const invalid of [
  { ...event, question: email },
  { ...event, extra: 'anything' },
  { ...event, guideId: 'reconectar-whatsapp' },
  { ...event, path: '/docs/canais?token=fake' },
  { ...event, path: '/docs/canais#fragment' },
  { ...event, path: 'https://example.test/docs/canais' },
]) assert.throws(() => normalizeSessionEvent(invalid), /Evento inválido/);

const eventFile = join(tmp, 'session-events.jsonl');
const now = Date.now();
await saveSessionEvent(eventFile, { ...event, createdAt: new Date(now - 31 * 24 * 60 * 60_000).toISOString() }, { now });
await saveSessionEvent(eventFile, { ...event, sessionId: 'fixture-session-2' }, { now });
assert.equal(await pruneSessionEvents(eventFile, { now, retentionDays: 30 }), 1);
let rows = (await readFile(eventFile, 'utf8')).trim().split('\n').map(JSON.parse);
assert.deepEqual(rows.map(({ sessionId }) => sessionId), ['fixture-session-2']);
assert.equal(await discardSessionEvents(eventFile, 'fixture-session-2'), 1);
assert.equal(await readFile(eventFile, 'utf8'), '');
console.log('data minimization: ok');
