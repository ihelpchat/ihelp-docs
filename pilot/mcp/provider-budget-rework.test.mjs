import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBudgetedResponse } from './provider-budget.mjs';
import { answerQuestion } from './assistant-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), 'claricia-rework-'));
const budget = (name) => ({ file: join(dir, name), dailyLimitUsd: 1, reserveUsd: 0.1 });
const payload = { model: 'fixture', input: 'fixture', max_output_tokens: 10 };
const completed = { status: 'completed', output_text: '{}', usage: { input_tokens: 1, output_tokens: 1 } };

try {
  for (const [status, output_text] of [
    ['failed', ''], ['failed', '{}'], ['cancelled', '{}'], ['unknown', '{}'], ['', '{}'], [undefined, '{}'], ['completed', ''],
  ]) {
    const result = await createBudgetedResponse({ responses: { create: async () => ({ ...completed, status, output_text }) } }, payload, budget(`status-${String(status)}-${output_text.length}.json`));
    assert.equal(result.kind, 'provider_failed', `status ${String(status)} e texto ${JSON.stringify(output_text)} falham fechado`);
  }
  assert.equal((await createBudgetedResponse({ responses: { create: async () => completed } }, payload, budget('completed.json'))).kind, 'ok');

  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    response.writeHead(requests < 3 ? 500 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(requests < 3 ? { error: { message: 'fixture failure', type: 'server_error' } } : completed));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const reply = await answerQuestion(root, 'como criar campanha no whatsapp', {
      apiKey: 'local-fixture', baseURL: `http://127.0.0.1:${server.address().port}/v1`, budget: budget('sdk.json'),
    });
    assert.equal(requests, 1, 'SDK não repete requests sob a mesma reserva');
    assert.match(reply.answer, /Tive um problema/);
    assert.deepEqual(reply.suggestions, [], 'handoff não é pergunta nova');
    assert.deepEqual(reply.actions, [{ type: 'link', destination: 'support', label: 'Falar com uma pessoa' }]);
  } finally { await new Promise((resolve) => server.close(resolve)); }

  let modelCalls = 0;
  const human = await answerQuestion(root, 'Quero falar com uma pessoa', {
    client: { responses: { create: async () => { modelCalls++; return completed; } } }, budget: budget('human.json'),
  });
  assert.equal(modelCalls, 0, 'pedido humano é local e não gasta orçamento');
  assert.deepEqual(human.actions, [{ type: 'link', destination: 'support', label: 'Falar com uma pessoa' }]);
  assert.deepEqual(human.suggestions, []);
} finally { await rm(dir, { recursive: true, force: true }); }
