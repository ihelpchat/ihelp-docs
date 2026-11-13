import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { answerQuestion } from './assistant-service.mjs';
import { guideSchema } from '../architecture/conversation-v1.mjs';
import { publishedGuideFromDraft } from '../lib/widget-guide-draft.mjs';

// Grafo explícito (roteiros v2): cada ramo termina no outcome declarado, sem inferência por posição.
const root = await mkdtemp(join(tmpdir(), 'guide-graph-'));
const client = { responses: { create: async () => { throw new Error('modelo chamado no passo'); } } };
const draft = async (id) => JSON.parse(await readFile(new URL(`../architecture/widget-guides-drafts/${id}.json`, import.meta.url), 'utf8'));
const guides = {};
try {
  const dir = join(root, 'content/docs/docs/principais-motivos-de-suporte');
  await mkdir(dir, { recursive: true });
  for (const id of ['usuario-acesso', 'reconectar-canal-qr']) {
    guides[id] = publishedGuideFromDraft(await draft(id), { mode: 'real' });
    await writeFile(join(dir, `${id}.mdx`), `---\n${stringify({ title: id, description: 'Roteiro de teste.', guide: guides[id] })}---\nConteúdo de teste.\n`);
  }
  const run = (question, guide) => answerQuestion(root, question, { guide, history: [], client });
  const start = (guideId) => ({ guideId, stepId: guides[guideId].initialStepId, version: 2, mode: 'real' });
  const choose = (reply, choiceId) => run(choiceId, { ...reply.guide, choiceId });

  // Caminho feliz até `complete` numa escolha sem passo seguinte.
  let reply = await run('Vamos começar', start('usuario-acesso'));
  assert.equal(reply.guide.stepId, 'abrir-usuarios');
  reply = await run('Concluí este passo', reply.guide);
  assert.equal(reply.guide.stepId, 'criar-usuario');
  assert.deepEqual(reply.suggestions, ['O formulário abriu', 'Está bloqueado']);
  reply = await choose(reply, 'abriu');
  assert.equal(reply.guide.stepId, 'preencher-dados');
  for (const expected of ['escolher-perfil', 'escolher-departamento', 'salvar-usuario']) {
    reply = await run('Concluí este passo', reply.guide);
    assert.equal(reply.guide.stepId, expected, 'segue next, não a posição');
  }
  reply = await choose(reply, 'criado');
  assert.equal(reply.guide.stepId, 'revisar-acesso');
  reply = await run('Concluí este passo', reply.guide);
  assert.equal(reply.guide.stepId, 'conferir-acesso');
  const done = await choose(reply, 'conferiu');
  assert.equal(done.resolution, 'complete');
  assert.equal(done.answer, 'Você concluiu o guia.');
  assert.equal(done.escalation, undefined);

  // `pedir-ajuda` é o último passo do arquivo, mas não conclui: termina em handoff.
  reply = await run('Vamos começar', start('usuario-acesso'));
  reply = await run('Concluí este passo', reply.guide);
  reply = await choose(reply, 'bloqueado');
  assert.equal(reply.guide.stepId, 'pedir-ajuda');
  assert.deepEqual(reply.suggestions, ['Falar com uma pessoa', 'Voltar']);
  const concluding = await run('Deu certo? Sim', reply.guide);
  assert.equal(concluding.resolution, 'partial');
  assert.equal(concluding.escalation.guideId, 'usuario-acesso');
  assert.equal(concluding.escalation.stepId, 'pedir-ajuda');
  const back = await run('Voltar', reply.guide);
  assert.equal(back.guide.stepId, 'criar-usuario');

  // Passo `paused` do QR: pausa sem concluir e sem chamar atendente.
  reply = await run('Vamos começar', start('reconectar-canal-qr'));
  const qr = guides['reconectar-canal-qr'];
  const pause = qr.steps.find((step) => step.next?.outcome === 'paused');
  const parent = qr.steps.find((step) => step.choices?.some((choice) => choice.nextStepId === pause.stepId));
  const path = [];
  for (let at = parent.stepId; at !== qr.initialStepId;) {
    const previous = qr.steps.find((step) => step.next?.nextStepId === at || step.choices?.some((choice) => choice.nextStepId === at));
    path.unshift({ step: previous, to: at });
    at = previous.stepId;
  }
  for (const { step, to } of path) {
    reply = step.choices?.length
      ? await choose(reply, step.choices.find((choice) => choice.nextStepId === to).id)
      : await run('Concluí este passo', reply.guide);
    assert.equal(reply.guide.stepId, to);
  }
  reply = await choose(reply, parent.choices.find((choice) => choice.nextStepId === pause.stepId).id);
  assert.equal(reply.guide.stepId, pause.stepId);
  const paused = await run('Concluí este passo', reply.guide);
  assert.equal(paused.resolution, 'partial');
  assert.equal(paused.escalation, undefined);
  assert.deepEqual(paused.suggestions, ['Recomeçar', 'Falar com uma pessoa']);

  // O formato recusa grafo incompleto, ambíguo, com ciclo e campos de grafo sem `transitions: explicit`.
  const base = guides['usuario-acesso'];
  const without = (mutate) => { const copy = structuredClone(base); mutate(copy); return guideSchema.safeParse(copy).success; };
  assert.equal(without((g) => { delete g.steps[0].next; }), false, 'passo sem destino');
  assert.equal(without((g) => { g.steps[1].choices[0].outcome = 'complete'; }), false, 'escolha com destino e outcome');
  assert.equal(without((g) => { g.steps[2].next = { nextStepId: 'abrir-usuarios' }; }), false, 'ciclo');
  assert.equal(without((g) => { delete g.transitions; }), false, 'next sem explicit');
  assert.equal(without((g) => { g.steps[0].route = '/admin'; }), false, 'rota fora do catálogo');
  console.log('guide-explicit-graph: complete, handoff, paused, voltar e validação do grafo ok');
} finally {
  await rm(root, { recursive: true, force: true });
}
