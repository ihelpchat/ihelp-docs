import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as env from './env-compat.mjs';
import { routeMessage } from './closed-router.mjs';
import { createBudgetedResponse } from './provider-budget.mjs';

const catalog = [
  { guideId: 'qr', title: 'Reconectar WhatsApp', question: 'Como reconectar pelo QR?' },
  { guideId: 'recado', title: 'Recado fora do horário', question: 'Como criar recado?' },
];
const dir = await mkdtemp(join(tmpdir(), 'm548-provider-'));
const budget = (name) => ({ file: join(dir, name), dailyLimitUsd: 1, reserveUsd: 0.1 });

try {
  await test('bypass de admissão só aparece no self-check', async () => {
    const files = (await readdir(new URL('./', import.meta.url))).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
    const uses = [];
    for (const name of files) {
      const source = await readFile(new URL(name, import.meta.url), 'utf8');
      if (/bypassAdmission:\s*true/u.test(source)) uses.push(name);
    }
    assert.deepEqual(uses, ['closed-router.mjs'], 'somente routerSelfCheck pode ignorar admissão');
    assert.match(await readFile(new URL('./closed-router.mjs', import.meta.url), 'utf8'),
      /routerSelfCheck[\s\S]*?createBudgetedResponse\([^\n]*bypassAdmission: true/u,
      'self-check deve passar bypass explícito');
  });
  await test('todo payload da triagem usa o esforço configurado', async () => {
    assert.equal(typeof env.assistantRouterEffort, 'function', 'assistantRouterEffort deve existir');
    assert.equal(env.assistantRouterEffort({}), 'none', 'padrão compatível com gpt-6-luna');
    for (const effort of ['none', 'minimal', 'low', 'medium', 'high']) {
      assert.equal(env.assistantRouterEffort({ ASSISTANT_ROUTER_EFFORT: effort }), effort);
    }
    for (const effort of ['none', 'low']) {
      process.env.ASSISTANT_ROUTER_EFFORT = effort;
      let payload;
      const client = { responses: { create: async (value) => {
        payload = value;
        return { status: 'completed', output_text: '{"choice":"perguntar"}', usage: { input_tokens: 1, output_tokens: 1 } };
      } } };
      await routeMessage('Como reconectar pelo QR?', { catalog, client, budget: budget(`effort-${effort}.json`) });
      assert.equal(payload.reasoning.effort, env.assistantRouterEffort(), 'payload deve usar configuração única');
      assert.equal(payload.reasoning.effort, effort);
    }
  });

  await test('esforço inválido impede inicialização com motivo', () => {
    const result = spawnSync(process.execPath, [new URL('./http.mjs', import.meta.url).pathname], {
      env: { ...process.env, DOCS_MCP_API_KEY: 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz', ASSISTANT_ROUTER_EFFORT: 'foo', PORT: '0' },
      encoding: 'utf8', timeout: 2000,
    });
    assert.notEqual(result.status, 0, 'http.mjs deve rejeitar foo antes de ouvir porta');
    assert.match(result.stderr, /ASSISTANT_ROUTER_EFFORT.*foo/u, 'erro deve nomear configuração e valor');
  });

  await test('4xx inválido libera reserva e não aumenta spent; 408, 429 e 500 cobram', async () => {
    for (const [status, spent] of [[400, 0], [401, 0], [403, 0], [404, 0], [422, 0], [408, 100_000], [429, 100_000], [500, 100_000]]) {
      const file = join(dir, `status-${status}.json`);
      const client = { responses: { create: async () => { throw Object.assign(new Error('Unsupported value'), { status }); } } };
      await assert.rejects(createBudgetedResponse(client, { model: 'fixture', input: 'teste' }, { ...budget(`status-${status}.json`), file }), /Unsupported value/u);
      const ledger = JSON.parse(await readFile(file, 'utf8'));
      assert.deepEqual(ledger.reservations, {}, `${status}: reserva deve ser reconciliada`);
      assert.equal(ledger.spent, spent, `${status}: spent incorreto`);
    }
  });
} finally {
  delete process.env.ASSISTANT_ROUTER_EFFORT;
  await rm(dir, { recursive: true, force: true });
}
