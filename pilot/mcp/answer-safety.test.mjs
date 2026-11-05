import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { classifyAnswerSafety, classifyAnswerSafetyResult } from './answer-safety.mjs';
import { cases, documentedSteps } from './answer-safety-fixtures.mjs';

test('20 respostas fictícias são enviadas ao classificador binário e falha fecha', async () => {
  assert.equal(cases.length, 20);
  assert.equal(cases.filter(({ source, action }) => source || action).length, 10);
  let calls = 0;
  const client = { responses: { create: async (payload) => {
    assert.equal(payload.text.format.name, 'seguranca_resposta');
    assert.deepEqual(payload.text.format.schema.required, ['mentionsSource', 'unsupportedAction']);
    const { answer, documentedSteps: supplied } = JSON.parse(payload.input.at(-1).content);
    assert.deepEqual(supplied, documentedSteps);
    calls++;
    const item = cases.find(({ text }) => text === answer.answer);
    return { status: 'completed', usage: { input_tokens: 5, output_tokens: 5 },
      output_text: JSON.stringify({ mentionsSource: item.source, unsupportedAction: item.action }) };
  } } };
  for (const item of cases) {
    const actual = await classifyAnswerSafety(client, { answer: item.text }, documentedSteps);
    assert.deepEqual(actual, { mentionsSource: item.source, unsupportedAction: item.action });
  }
  assert.equal(calls, 20);
  assert.equal(await classifyAnswerSafety({ responses: { create: async () => { throw Error('offline'); } } },
    { answer: 'Exemplo' }, documentedSteps), null);
});


test('resultado técnico preserva motivo, sem tratá-lo como rejeição de conteúdo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safety-reasons-'));
  try {
    let calls = 0;
    const client = { responses: { create: async () => { calls++; return { status: 'completed', output_text: 'bad', usage: { input_tokens: 1, output_tokens: 1 } }; } } };
    const budget = { file: join(dir, 'budget.json'), dailyLimitUsd: 10, reserveUsd: 0.1 };
    assert.deepEqual(await classifyAnswerSafetyResult(client, {}, [], budget), { kind: 'unavailable', reason: 'invalid' });
    assert.deepEqual(await classifyAnswerSafetyResult(client, {}, [], { ...budget, dailyLimitUsd: 0 }), { kind: 'unavailable', reason: 'budget_exhausted' });
    const controller = new AbortController(); controller.abort();
    assert.deepEqual(await classifyAnswerSafetyResult(client, {}, [], { ...budget, signal: controller.signal }), { kind: 'unavailable', reason: 'provider_failed' });
    assert.equal(calls, 1, 'budget e abort não chamam provider');
    const failed = { responses: { create: async () => ({ status: 'failed', output_text: '', usage: { input_tokens: 1, output_tokens: 1 } }) } };
    assert.deepEqual(await classifyAnswerSafetyResult(failed, {}, [], budget), { kind: 'unavailable', reason: 'provider_failed' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
