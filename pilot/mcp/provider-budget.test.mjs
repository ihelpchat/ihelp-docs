import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createBudgetedResponse } from './provider-budget.mjs';
import { answerQuestion } from './assistant-service.mjs';

const dir = await mkdtemp(join(tmpdir(), 'claricia-budget-'));
const file = join(dir, 'ledger.json');
const fixed = { file, dailyLimitUsd: 0.20, reserveUsd: 0.10, inputUsdPerMillion: 1, outputUsdPerMillion: 1 };
const payload = { model: 'test-model', max_output_tokens: 100, input: 'fixture' };
const ok = { status: 'completed', output_text: '{}', usage: { input_tokens: 10, output_tokens: 10 } };
const call = (client, config = fixed) => createBudgetedResponse(client, payload, config);
try {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = { responses: { create: async () => { calls++; await gate; return ok; } } };
  const pending = [call(slow), call(slow)];
  while (calls < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  const third = await Promise.race([
    call(slow),
    new Promise((resolve) => setTimeout(() => resolve({ kind: 'unexpected_provider_call' }), 200)),
  ]);
  release();
  const simultaneous = [...await Promise.all(pending), third];
  assert.equal(simultaneous.filter((result) => result.kind === 'ok').length, 2, 'reserva atômica limita chamadas concorrentes');
  assert.equal(calls, 2);
  assert.equal(simultaneous[2].kind, 'budget_exhausted');

  const reconciledFile = join(dir, 'reconciled.json');
  const cheap = { responses: { create: async () => ok } };
  assert.equal((await call(cheap, { ...fixed, file: reconciledFile })).kind, 'ok');
  assert.equal((await call(cheap, { ...fixed, file: reconciledFile })).kind, 'ok');
  assert.equal((await call(cheap, { ...fixed, file: reconciledFile })).kind, 'ok',
    'usage reconcilia a reserva e libera orçamento não gasto');

  // Processo novo usa o mesmo ledger: uma reserva sem usage continua cobrada.
  const restartFile = join(dir, 'restart.json');
  const missingUsage = { responses: { create: async () => ({ status: 'completed', output_text: '{}'}) } };
  await call(missingUsage, { ...fixed, file: restartFile, dailyLimitUsd: 0.10 });
  const child = `import {createBudgetedResponse} from ${JSON.stringify(new URL('./provider-budget.mjs', import.meta.url).href)}; const r=await createBudgetedResponse({responses:{create:async()=>{throw Error('provider chamado')}}}, ${JSON.stringify(payload)}, ${JSON.stringify({ ...fixed, file: restartFile, dailyLimitUsd: 0.10 })}); process.stdout.write(r.kind);`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' }), 'budget_exhausted', 'reinício preserva gasto');

  const retryFile = join(dir, 'retry.json');
  let attempts = 0;
  const incomplete = { responses: { create: async () => { attempts++; return { status: 'incomplete', usage: { input_tokens: 1, output_tokens: 1 } }; } } };
  const retried = await call(incomplete, { ...fixed, file: retryFile, dailyLimitUsd: 1 });
  assert.equal(retried.kind, 'provider_failed');
  assert.equal(attempts, 2, 'incomplete recebe exatamente uma nova tentativa');

  const timeoutFile = join(dir, 'timeout.json');
  const timeout = { responses: { create: async () => { throw new Error('timeout'); } } };
  await assert.rejects(call(timeout, { ...fixed, file: timeoutFile, dailyLimitUsd: 0.10 }), /timeout/);
  assert.equal((await call(slow, { ...fixed, file: timeoutFile, dailyLimitUsd: 0.10 })).kind, 'budget_exhausted', 'timeout mantém reserva');

  let fallbackCalls = 0;
  const fallback = await answerQuestion(new URL('../', import.meta.url).pathname, 'como criar campanha no whatsapp', {
    client: { responses: { create: async () => { fallbackCalls++; return ok; } } },
    budget: { ...fixed, file: join(dir, 'fallback.json'), dailyLimitUsd: 0 },
  });
  assert.equal(fallbackCalls, 0, 'orçamento esgotado não consulta provider');
  assert.ok(fallback.sources.length > 0 && fallback.steps.length > 0, 'guia fixo continua disponível');
  assert.ok(fallback.suggestions.includes('Falar com uma pessoa'), 'humano continua disponível');
} finally {
  await rm(dir, { recursive: true, force: true });
}
console.log('M5.13: concorrência, restart, reconciliação, falhas e fallback passaram.');
