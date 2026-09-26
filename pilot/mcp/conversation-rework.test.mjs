import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assistantRequestSchema } from '../architecture/conversation-v1.mjs';
import { summarizeConversations } from './conversation-log.mjs';
import * as admin from './conversation-admin.mjs';

const now = Date.parse('2026-09-26T12:00:00Z');
const rows = [
  { sessionId: 'human', at: '2026-09-26T11:59:00Z', question: 'Pedi ajuda', resolution: 'partial', offeredHuman: true },
  { sessionId: 'done', at: '2026-09-26T11:58:00Z', question: 'Resolvi', resolution: 'complete' },
  { sessionId: 'old', at: '2026-09-26T11:29:59Z', question: 'Ainda preciso', resolution: 'in_progress' },
  { sessionId: 'fresh', at: '2026-09-26T11:30:00Z', question: 'Estou tentando', resolution: 'partial' },
  { sessionId: 'missing', at: '2026-09-26T11:57:00Z', question: 'Sem guia', resolution: 'not_found' },
  { sessionId: 'followed', at: '2026-09-26T10:00:00Z', question: 'Pergunta anterior', resolution: 'in_progress' },
  { sessionId: 'followed', at: '2026-09-26T11:56:00Z', question: 'Resolvida depois', resolution: 'complete' },
];
const summary = summarizeConversations(rows, {}, { now });
assert.equal(summary.total, 7, 'total de perguntas continua sendo linhas');
assert.ok(summary.percentages.escalated > 0, 'offeredHuman classifica encaminhamento');
assert.ok(summary.percentages.abandoned > 0, 'só último turno vencido desiste');
assert.ok(summary.percentages.partial > 0, 'turno no limite de 30 minutos continua parcial');
assert.equal(Object.values(summary.percentages).reduce((sum, value) => sum + value, 0), 100);
assert.ok(summary.unresolved.some((row) => row.question === 'Ainda preciso'));
assert.ok(!summary.unresolved.some((row) => row.question === 'Pergunta anterior'));
const reopened = summarizeConversations([
  { sessionId: 'reopened', at: '2026-09-26T10:00:00Z', question: 'Resolvida antes', resolution: 'complete' },
  { sessionId: 'reopened', at: '2026-09-26T11:00:00Z', question: 'Nova dúvida sem resposta', resolution: 'partial' },
], {}, { now: Date.parse('2026-09-26T11:31:00Z') });
assert.equal(reopened.percentages.abandoned, 100, 'último turno parcial vencido define a sessão');
assert.equal(reopened.unresolvedTotal, 1, 'complete anterior não resolve o último turno parcial');
assert.equal(reopened.unresolved[0].question, 'Nova dúvida sem resposta', 'lista mostra a última pergunta');
assert.equal(summarizeConversations(rows, { resolution: 'escalated' }, { now }).total, 1,
  'filtro Pessoa inclui partial com offeredHuman');
assert.equal(summarizeConversations(rows, { resolution: 'abandoned' }, { now }).unresolved[0].question, 'Ainda preciso');

const contract = JSON.parse(await readFile(new URL('../architecture/conversation-v1.schema.json', import.meta.url)));
assert.deepEqual(
  { if: contract.schemas.AssistantRequestV1.if, then: contract.schemas.AssistantRequestV1.then },
  { if: { properties: { origin: { not: { const: 'app' } } } }, then: { not: { required: ['companyId'] } } },
  'JSON Schema proíbe companyId quando origin não é app, inclusive origin ausente',
);
for (const [input, valid] of [
  [{ question: 'Oi', origin: 'faq', companyId: 42 }, false],
  [{ question: 'Oi', origin: 'app', companyId: 42 }, true],
  [{ question: 'Oi', origin: 'app' }, true],
]) {
  assert.equal(assistantRequestSchema.safeParse(input).success, valid, 'Zod valida vínculo empresa/origem');
}

assert.equal(typeof admin.renderRows, 'function', 'linhas usam renderRows puro');
const html = admin.renderRows([['2026-09-26T12:00:00Z', 'faq', '<script>bad()</script>',
  '<img src=x onerror=alert(1)>', '<script>alert(2)</script>']]);
assert.match(html, /&lt;img/);
assert.match(html, /&lt;script&gt;/);
assert.doesNotMatch(html, /<img|<script/);
assert.match(admin.adminPage, /innerHTML=renderRows\(/, 'tabelas usam somente o HTML escapado');
console.log('M5.51 rework: OK');
