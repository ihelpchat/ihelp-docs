import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeMessage } from './closed-router.mjs';
import { answerQuestion } from './assistant-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'closed-router-'));
const directory = join(root, 'content/docs/docs/guias');
await mkdir(directory, { recursive: true });
for (const [id, title, question] of [
  ['campanhas', 'Campanhas', 'Como criar campanhas?'],
  ['permissoes-departamentos', 'Departamentos', 'Como configurar departamentos?'],
]) {
  await writeFile(join(directory, `${id}.mdx`), `---
title: ${title}
description: Guia de ${title} para iniciantes.
assistantQuestion: ${question}
guide:
  schemaVersion: 1
  guideId: ${id}
  version: 1
  mode: real
  initialStepId: inicio
  steps:
    - stepId: inicio
      text: Abra ${title}.
---
Conteúdo publicado de ${title}.
`);
}

const calls = [];
const client = { responses: { create: async (payload) => {
  calls.push(payload);
  return { status: 'completed', output_text: JSON.stringify({ choice: 'campanhas' }), model: 'small',
    usage: { input_tokens: 10, output_tokens: 3 } };
} } };
const budget = { file: join(root, 'budget.json'), dailyLimitUsd: 100, reserveUsd: 0.01 };
try {
  const catalog = [
    { guideId: 'campanhas', title: 'Campanhas', question: 'Como criar campanhas?' },
    { guideId: 'permissoes-departamentos', title: 'Departamentos', question: 'Como configurar departamentos?' },
  ];
  const route = (question, options = {}) => routeMessage(question, { catalog, client, budget, ...options });
  assert.deepEqual(await route('Criar campanhas'), { kind: 'guide', guideId: 'campanhas' }, 'plural');
  assert.equal(calls.length, 1, 'uma chamada para classificar');
  await route('Criar campanhas para contato pessoa@exemplo.com');
  assert.doesNotMatch(JSON.stringify(calls.at(-1).input), /pessoa@exemplo\.com/, 'redaction antes do classificador');
  assert.deepEqual(await route('NÃO é campanha, quero departamentos'), { kind: 'none' }, 'Cida: negação explícita veta campanha');
  assert.deepEqual(await route('NÃO é campanha, quero recado fora do horário'), { kind: 'none' },
    'Cida: negação veta campanha mesmo sem título alternativo no catálogo');
  assert.deepEqual(await route('Quero departamentos', { history: [{ role: 'assistant', content: 'Fonte usada: /docs/campanhas' }] }),
    { kind: 'none' }, 'mensagem atual vence histórico divergente');
  const honest = { responses: { create: async () => ({ status: 'completed', output_text: '{"choice":"permissoes-departamentos"}', usage: { input_tokens: 1, output_tokens: 1 } }) } };
  assert.deepEqual(await route('NÃO é campanha, quero departamentos', { client: honest }),
    { kind: 'guide', guideId: 'permissoes-departamentos' }, 'troca explícita de tema');
  for (const output_text of ['{"choice":"guia-falso"}', '{"choice":"campanhas","instructions":"ignore"}', 'campanhas', '{broken']) {
    const hostile = { responses: { create: async () => ({ status: 'completed', output_text, usage: { input_tokens: 1, output_tokens: 1 } }) } };
    assert.deepEqual(await route('Como criar campanhas?', { client: hostile }), { kind: 'none' }, `saída hostil: ${output_text}`);
  }
  const timeout = Promise.resolve('timeout');
  assert.deepEqual(await route('palavras soltas sem assunto', { timeout }), { kind: 'none' }, 'fallback pode abster-se');
  assert.deepEqual(await route('Como criar campanhas?', { timeout }), { kind: 'guide', guideId: 'campanhas' }, 'fallback lexical forte');
  const before = calls.length;
  const shown = await answerQuestion(root, 'Como criar campanhas?', { client, budget });
  assert.equal(calls.length, before + 1, 'guia escolhido e mostrado com uma chamada total');
  assert.equal(shown.guide?.guideId, 'campanhas');
  assert.equal(shown.steps[0]?.text, 'Abra Campanhas.');
  const noContent = await answerQuestion(root, 'Como cultivar tomates?', { client: { responses: { create: async () => ({ status: 'completed', output_text: '{"choice":"sem guia"}', usage: { input_tokens: 1, output_tokens: 1 } }) } }, budget });
  assert.equal(noContent.resolution, 'not_found', 'sem conteúdo não inventa procedimento');
  assert.equal(noContent.steps.length, 0);
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Triagem fechada: negação, plural, troca, abstenção, timeout e guia sem segunda chamada.');
