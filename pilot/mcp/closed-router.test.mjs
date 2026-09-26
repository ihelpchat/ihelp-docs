import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeMessage } from './closed-router.mjs';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';

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
await writeFile(join(directory, 'recado.mdx'), `---
title: Recado fora do horário no WhatsApp
description: Configure o recado fora do horário no WhatsApp.
---
Abra Departamentos e configure o recado fora do horário no WhatsApp.
`);

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
  const human = await answerQuestion(root, 'Quero falar com uma pessoa', { budget });
  assert.deepEqual(human.actions, [{ type: 'link', destination: 'support', label: 'Falar com uma pessoa' }],
    'pedido de pessoa funciona sem provider e antes da triagem');
  const cida = await retrieveContext(root, 'NÃO é campanha, quero fazer recado fora do horário no whatsapp');
  assert.notEqual(cida[0]?.path, '/docs/guias/campanhas', 'sem guia não prioriza campanha negada');
  const models = [];
  const splitClient = { responses: { create: async (payload) => {
    models.push(payload.model);
    return { status: 'completed', output_text: '{"choice":"sem guia"}', usage: { input_tokens: 1, output_tokens: 1 } };
  } } };
  process.env.ASSISTANT_ROUTER_MODEL = 'router-small-test';
  process.env.OPENAI_MODEL = 'answer-large-test';
  try {
    await answerQuestion(root, 'Como criar campanhas?', { client: splitClient, budget });
    assert.deepEqual(models, ['router-small-test', 'answer-large-test'],
      'sem guia usa router pequeno e modelo final distinto');
  } finally {
    delete process.env.ASSISTANT_ROUTER_MODEL;
    delete process.env.OPENAI_MODEL;
  }
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const lateCalls = [];
  const lateClient = { responses: { create: async (payload, requestOptions) => {
    lateCalls.push(requestOptions?.signal);
    started();
    await new Promise((resolve) => { release = resolve; });
    return { status: 'incomplete', usage: { input_tokens: 1, output_tokens: 1 } };
  } } };
  let expire;
  const deadline = new Promise((resolve) => { expire = () => resolve('timeout'); });
  const pending = route('Como criar campanhas?', { client: lateClient, timeout: deadline });
  await entered;
  expire();
  assert.deepEqual(await pending, { kind: 'guide', guideId: 'campanhas' });
  assert.equal(lateCalls.length, 1);
  assert.equal(lateCalls[0]?.aborted, true, 'timeout aborta o request em andamento');
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lateCalls.length, 1, 'resposta incomplete atrasada não dispara retry');
  assert.deepEqual(await route('NÃO é campanha, quero recado fora do horário', { timeout }), { kind: 'none' },
    'fallback após timeout não escolhe guia negado');
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Triagem fechada: negação, plural, troca, abstenção, timeout e guia sem segunda chamada.');
