import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectGaps } from './lacunas.mjs';
import { actionForQuestion, issueForQuestion } from './gap-classification.mjs';
import { normalizeSessionEvent, saveSessionEvent, sessionEventSchema } from './session-events.mjs';

const root = new URL('../', import.meta.url).pathname;
const now = Date.now();
const event = { origin: 'faq', durationMs: 1, result: 'not_found', path: '/assistente' };
async function scenario(rows) {
  const file = join(await mkdtemp(join(tmpdir(), 'm540-rework-')), 'events.jsonl');
  for (const [sessionId, question] of rows) await saveSessionEvent(file, {
    ...event, sessionId, topic: 'abrir-canais', action: actionForQuestion(question),
    issue: issueForQuestion(question),
  }, { now });
  return collectGaps(root, file, { now });
}
const three = (question) => [1, 2, 3].map((n) => [`session-${n}`, question]);

for (const question of ['O QR caiu de novo', 'Parou de funcionar']) {
  const gaps = await scenario(three(question));
  assert.deepEqual(gaps.documentable, [], `${question}: não pode virar artigo`);
  assert.match(gaps.review[0].reason, /revisão humana/u, `${question}: motivo explícito`);
  assert.equal(gaps.review[0].sessions, 3);
}

const reconectar = 'Como reconectar QR?';
const adicionar = 'Como adicionar outro canal?';
const split = await scenario([...three(adicionar).slice(0, 2), ['session-3', reconectar]]);
assert.deepEqual(split.documentable, [], 'mudar só action não soma sessões');

const newGuide = await scenario(three(adicionar));
assert.equal(newGuide.documentable[0].action, 'adicionar');
assert.equal(newGuide.documentable[0].proposal, 'criar', 'adicionar não reutiliza reconectar');
assert.equal(newGuide.documentable[0].sessions, 3);

const existing = await scenario(three(reconectar));
assert.equal(existing.documentable[0].action, 'reconectar');
assert.equal(existing.documentable[0].proposal, 'atualizar');
assert.equal(existing.documentable[0].guideId, 'reconectar-canal-qr');

assert.equal(issueForQuestion('Como reconectar QR com erro?'), 'incident');
assert.equal(issueForQuestion('Como reconectar QR sem permissão?'), 'permission');
assert.equal(issueForQuestion('Como reconectar QR?', { module: 'channels', channels: [{ kind: 'whatsapp', state: 'disconnected' }] }), 'account_state');
assert.equal(issueForQuestion('Como reconectar QR?'), 'usage');
assert.equal(actionForQuestion('Como teletransportar outro canal?'), undefined);
assert.equal(normalizeSessionEvent({ ...event, sessionId: 'session-4', topic: 'abrir-canais', action: 'teletransportar', issue: 'usage' }).action, undefined);
assert.equal(sessionEventSchema.safeParse({ ...event, sessionId: 'session-4', action: 'teletransportar' }).success, false);
assert.equal(sessionEventSchema.safeParse({ ...event, sessionId: 'session-4', action: 'reconectar', extra: 'texto bruto' }).success, false);
console.log('lacunas rework: classificação fechada, equivalência e reuso por ação ok');
