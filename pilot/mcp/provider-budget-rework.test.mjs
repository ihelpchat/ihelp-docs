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
  for (const [status, output_text, throws, expectedRequests] of [
    ['failed', '', false, 1], ['failed', '{}', false, 1], ['cancelled', '{}', false, 1],
    ['unknown', '{}', false, 1], ['', '{}', false, 1], [undefined, '{}', false, 1],
    ['completed', '', false, 1], ['completed', '   ', false, 1],
    ['incomplete', '{}', false, 2], ['network error', '', true, 1],
  ]) {
    let requests = 0;
    const client = { responses: { create: async () => {
      requests++;
      if (throws) throw new Error('fixture network error');
      return { ...completed, status, output_text };
    } } };
    const run = () => createBudgetedResponse(client, payload, budget(`status-${String(status)}-${output_text.length}.json`));
    if (throws) {
      await assert.rejects(run, /fixture network error/);
      assert.equal(requests, expectedRequests, `${status}: requests pagos`);
      continue;
    }
    const result = await run();
    assert.equal(result.kind, 'provider_failed', `status ${String(status)} e texto ${JSON.stringify(output_text)} falham fechado`);
    assert.equal(requests, expectedRequests, `${String(status)} e texto ${JSON.stringify(output_text)}: requests pagos`);
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
