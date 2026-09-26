import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion } from './assistant-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'm5-12-'));
const guideId = 'reconectar-canal-qr';
const state = (stepId = 'inicio', extra = {}) => ({ guideId, stepId, version: 1, mode: 'real', ...extra });
const calls = [];
const client = { responses: { create: async (request) => { calls.push(request); throw new Error('modelo chamado no passo'); } } };
const run = (question, guide, history = []) => answerQuestion(root, question, { guide, history, client });

try {
  const dir = join(root, 'content/docs/docs/principais-motivos-de-suporte');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${guideId}.mdx`), `---
title: Reconectar canal
description: Guia de reconexão.
guide:
  schemaVersion: 1
  guideId: reconectar-canal-qr
  version: 1
  mode: real
  initialStepId: inicio
  steps:
    - stepId: inicio
      text: Abra a tela de canais.
    - stepId: escolha
      text: Escolha o dispositivo.
      choices:
        - id: android
          label: Android
          nextStepId: android
        - id: iphone
          label: iPhone
          nextStepId: iphone
    - stepId: android
      text: Toque nos três pontos.
    - stepId: iphone
      text: Abra Ajustes.
---
Conteúdo de teste.
`);

  const first = await run('Vamos começar', state());
  assert.equal(first.guide.stepId, 'inicio');
  assert.equal(first.steps[0].text, 'Abra a tela de canais.');
  const next = await run('Concluí este passo', state(), [
    { role: 'assistant', content: 'Fonte usada: /docs/principais-motivos-de-suporte/campanhas\nPasso 9: publicar campanha' },
  ]);
  assert.equal(next.guide.stepId, 'escolha', 'troca de assunto não pode recuperar passo do histórico');
  assert.deepEqual(next.suggestions, ['Android', 'iPhone']);
  const branch = await run('Android', state('escolha', { pendingChoiceId: 'escolha', choiceId: 'android' }));
  assert.equal(branch.guide.stepId, 'android');
  assert.equal(branch.steps[0].text, 'Toque nos três pontos.');
  const replay = await run('Android', state('android', { choiceId: 'android' }));
  assert.equal(replay.guide.stepId, 'android');
  assert.match(replay.answer, /decisão|escolha|passo/i);
  const help = await run('Preciso de ajuda', state('android'));
  assert.equal(help.guide.stepId, 'android');
  assert.equal(help.steps[0].text, 'Toque nos três pontos.');
  const back = await run('Voltar', state('android'));
  assert.equal(back.guide.stepId, 'escolha');
  const invalid = await run('Avançar', state('android', { version: 2 }));
  assert.equal(invalid.guide, undefined);
  assert.match(invalid.answer, /versão|atualiz/i);
  const no = await run('Deu certo? Não', state('iphone'));
  assert.equal(no.resolution, 'partial');
  assert.equal(no.escalation.intent, 'connect_channel');
  assert.equal(no.guide.stepId, 'iphone');
  const human = await run('Quero falar com uma pessoa', state('inicio'));
  assert.equal(human.resolution, 'partial');
  assert.equal(human.escalation.intent, 'connect_channel');
  assert.equal(human.escalation.attempts.includes('documented_guide'), true);
  assert.equal(calls.length, 0, 'todo passo e handoff devem funcionar sem modelo');
} finally {
  await rm(root, { recursive: true, force: true });
}
