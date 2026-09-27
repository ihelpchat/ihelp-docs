import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planContent, generateContentPackage, generateCanonicalGuide } from './content-ai-service.mjs';
import { contentMaxOutputTokens } from './env-compat.mjs';

const root = new URL('../', import.meta.url).pathname;
const request = { topic: 'Importar contatos', module: 'Contatos', description: 'Documentar importação.' };
const productContext = { groundingRequired: false, code: [], matches: [], support: { categories: [], rules: [] }, coverage: [] };
const outputs = {
  plano_documentacao: { status: 'needs_information', guidance: 'Confirmar etapa.', questions: ['Qual etapa?'], risks: [], suggestedActions: [], grounding: [] },
  pacote_documentacao: { status: 'needs_information', summary: 'Confirmar etapa.', questions: ['Qual etapa?'], articles: [], grounding: [] },
  guia_canonico: { status: 'needs_information', questions: ['Qual etapa?'], article: null },
};
const operations = {
  plano_documentacao: (options) => planContent(root, request, options),
  pacote_documentacao: (options) => generateContentPackage(root, request, { ...options, plan: { status: 'ready' } }),
  guia_canonico: (options) => generateCanonicalGuide(root, { ...request, guideId: 'importar-contatos' }, { ...options, plan: { status: 'ready' } }),
};

for (const [name, run] of Object.entries(operations)) {
  for (const [mutation, status, output, expected] of [
    ['incomplete', 'incomplete', '{"status":"needs_information","questions":[', /resposta do modelo incompleta/],
    ['invalid JSON', 'completed', '{"status":', /resposta do modelo inválida/],
  ]) {
    test(`${name}: ${mutation} vira pendência`, async () => {
      const valid = JSON.stringify(outputs[name]);
      const client = { responses: { create: async (payload) => {
        assert.equal(payload.max_output_tokens, 16_000);
        return { model: 'fixture', status, output_text: output, usage: { input_tokens: 10, output_tokens: 10 } };
      } } };
      const positive = await run({ productContext, client: { responses: { create: async () => ({ model: 'fixture', status: 'completed', output_text: valid }) } } });
      assert.equal(positive.status, 'needs_information');
      const result = await run({ productContext, client });
      assert.equal(result.status, 'needs_information');
      assert.deepEqual(result.articles, []);
      assert.match(result.questions.join(' '), expected);
    });
  }
}

test('limite configurado no payload e valor inválido falha na inicialização', async () => {
  assert.equal(contentMaxOutputTokens({}), 16_000);
  assert.equal(contentMaxOutputTokens({ CONTENT_MAX_OUTPUT_TOKENS: '32000' }), 32_000);
  const old = process.env.CONTENT_MAX_OUTPUT_TOKENS;
  try {
    process.env.CONTENT_MAX_OUTPUT_TOKENS = '32000';
    await operations.plano_documentacao({ productContext, client: { responses: { create: async (payload) => {
      assert.equal(payload.max_output_tokens, 32_000);
      return { status: 'completed', output_text: JSON.stringify(outputs.plano_documentacao) };
    } } } });
  } finally {
    if (old === undefined) delete process.env.CONTENT_MAX_OUTPUT_TOKENS;
    else process.env.CONTENT_MAX_OUTPUT_TOKENS = old;
  }
  const child = spawnSync(process.execPath, ['-e', "import('./pilot/mcp/content-ai-service.mjs')"], {
    cwd: new URL('../../', import.meta.url), env: { ...process.env, CONTENT_MAX_OUTPUT_TOKENS: 'abc' }, encoding: 'utf8',
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /CONTENT_MAX_OUTPUT_TOKENS inválido/);
});

test('orçamento reserva saída padrão sem bloquear conteúdo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'm549-budget-'));
  let calls = 0;
  try {
    const result = await operations.plano_documentacao({ productContext, budget: { file: join(dir, 'budget.json'), dailyLimitUsd: 1 },
      client: { responses: { create: async (payload) => {
        calls++;
        assert.equal(payload.max_output_tokens, 16_000);
        return { model: 'fixture', status: 'completed', output_text: JSON.stringify(outputs.plano_documentacao), usage: { input_tokens: 10, output_tokens: 10 } };
      } } } });
    assert.equal(result.status, 'needs_information');
    assert.equal(calls, 1);
    const incomplete = await operations.plano_documentacao({ productContext,
      budget: { file: join(dir, 'incomplete.json'), dailyLimitUsd: 1 },
      client: { responses: { create: async () => {
        calls++;
        return { status: 'incomplete', output_text: '{"status":', usage: { input_tokens: 10, output_tokens: 16_000 } };
      } } } });
    assert.equal(incomplete.status, 'needs_information');
    assert.match(incomplete.questions.join(' '), /resposta do modelo incompleta/);
    assert.equal(calls, 2, 'conteúdo incompleto não faz segunda chamada');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
