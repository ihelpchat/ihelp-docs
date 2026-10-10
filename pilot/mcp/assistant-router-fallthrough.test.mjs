import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestion } from './assistant-service.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const deadEnd = 'Qual tarefa você quer fazer no iHelp?';

for (const choice of ['none', 'perguntar']) {
  test(`triagem "${choice}" não encerra a resposta: segue para o conteúdo do FAQ`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'router-fallthrough-'));
    try {
      const client = { responses: { create: async () => ({
        status: 'completed', output_text: JSON.stringify({ choice }), usage: { input_tokens: 1, output_tokens: 1 },
      }) } };
      const result = await answerQuestion(root, 'Como cadastrar um contato?', {
        client, budget: { file: join(dir, 'budget.json'), dailyLimitUsd: 1, reserveUsd: 0.1 },
      });
      assert.notEqual(result.answer, deadEnd, 'a triagem sem guia não pode virar beco sem saída');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
