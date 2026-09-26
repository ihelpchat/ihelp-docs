import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { answerGuide } from './guide-state.mjs';

const root = await mkdtemp(join(tmpdir(), 'guide-missing-handoff-'));
await mkdir(join(root, 'content/docs'), { recursive: true });
const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../lib/assistant.ts', import.meta.url), 'utf8'));
const compiled = ts.transpileModule(source.replace("from '../architecture/catalog-action.mjs'", `from '${new URL('../architecture/catalog-action.mjs', import.meta.url).href}'`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeReply, supportMessageFor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

try {
  for (const guideId of ['campanhas', 'guia-inventado']) {
    const state = { guideId, stepId: 'passo-forjado', version: 1, mode: 'real' };
    for (const question of ['Avançar', 'Falar com uma pessoa']) {
      const reply = normalizeReply(await answerGuide(root, question, state));
      const message = supportMessageFor(reply);
      assert.doesNotMatch(message, /passo-forjado/, 'passo sem MDX não pode entrar no handoff');
      assert.equal(reply.guide, undefined, 'estado seguro não deve carregar passo sem MDX');
      if (guideId === 'campanhas') {
        assert.match(message, /Guia: campanhas/);
        assert.equal(reply.escalation?.guideId, guideId);
        assert.equal(reply.escalation?.stepId, undefined);
      } else {
        assert.doesNotMatch(message, /guia-inventado|Guia:/);
        assert.equal(reply.escalation?.guideId, undefined);
      }
    }
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
