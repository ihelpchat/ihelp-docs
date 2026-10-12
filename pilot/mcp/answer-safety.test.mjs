import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAnswerSafety } from './answer-safety.mjs';
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
