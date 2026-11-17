import test, { after } from 'node:test';
import { answerQuestion } from './assistant-service.mjs';
import { normalizeSessionEvent } from './session-events.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatedGuideSchema, parseAssistantReply, parseAssistantRequest } from '../architecture/conversation-v1.mjs';
import { validateGeneratedGuide, generateGuide } from './generated-guide.mjs';
import { cacheSessionGuide, answerGuide } from './guide-state.mjs';
import { normalizeFeedback, saveFeedback, summarizeFeedback } from './feedback-service.mjs';

const step = { stepId: 'passo-1', title: 'Abrir tela', text: 'Abra a tela.', route: '/atendimento', locator: { kind: 'button', name: 'Abrir' }, next: { nextStepId: 'passo-2' } };
const guide = { schemaVersion: 1, guideId: 'gen-0123456789ab', version: 1, mode: 'gerado', transitions: 'explicit', initialStepId: 'passo-1', steps: [step, { ...step, stepId: 'passo-2', next: { outcome: 'complete' } }] };
const map = { routes: [{ path: '/atendimento' }], elements: [{ route: '/atendimento', kind: 'button', name: 'Abrir', duplicates: 1 }] };
const safeClient = { responses: { create: async () => ({ status: 'completed', output_text: JSON.stringify({ mentionsSource: false, unsupportedAction: false }), usage: { input_tokens: 1, output_tokens: 1 } }) } };
const temporary = [];
async function temp(prefix) { const dir = await mkdtemp(join(tmpdir(), prefix)); temporary.push(dir); return dir; }
after(async () => { for (const dir of temporary) await rm(dir, { recursive: true, force: true }); });
const budget = async () => ({ file: join(await temp('generated-guide-'), 'budget.json') });
test('generated schema: contract, IDs, explicit graph, cycles and limit', () => {
  assert.ok(generatedGuideSchema.safeParse(guide).success);
  for (const invalid of [{ ...guide, guideId: 'gen-no' }, { ...guide, transitions: undefined }, { ...guide, steps: Array(13).fill(step) }, { ...guide, steps: [step, { ...guide.steps[1], next: { nextStepId: 'passo-1' } }] }]) assert.equal(generatedGuideSchema.safeParse(invalid).success, false);
  parseAssistantRequest({ question: 'próximo', guide: { guideId: guide.guideId, stepId: 'passo-1', version: 1, mode: 'gerado' } });
});
test('hard validation rejects missing, ambiguous, unknown route and unsafe text', async () => {
  const options = { map, client: safeClient, documentedSteps: [step.text], budget: await budget() };
  await validateGeneratedGuide(guide, options);
  await assert.rejects(validateGeneratedGuide({ ...guide, steps: [{ ...guide.steps[1], stepId: 'passo-1', locator: { kind: 'button', name: 'Fake' } }] }, options), /locator_missing/);
  await assert.rejects(validateGeneratedGuide(guide, { ...options, map: { ...map, elements: [...map.elements, ...map.elements] } }), /ambiguous/);
  await assert.rejects(validateGeneratedGuide({ ...guide, steps: [{ ...guide.steps[1], stepId: 'passo-1', route: '/fake' }] }, options), /schema/);
  const unsafe = { responses: { create: async () => ({ status: 'completed', output_text: '{"mentionsSource":false,"unsupportedAction":true}', usage: { input_tokens: 1, output_tokens: 1 } }) } };
  await assert.rejects(validateGeneratedGuide(guide, { ...options, client: unsafe }), /unsafe/);
  await assert.rejects(validateGeneratedGuide({ ...guide, steps: [{ ...guide.steps[1], stepId: 'passo-1', text: 'Clique em "Botão inexistente xyz".' }] }, options), /rótulo fora/);
});
test('generated state shares signed machine; session isolation, next, handoff, pause', async () => {
  cacheSessionGuide('session-a', { guide, title: 'Guia', path: '/docs' });
  const state = { guideId: guide.guideId, stepId: guide.initialStepId, version: 1, mode: 'gerado' };
  const initial = await answerGuide('', 'iniciar', state, { sessionId: 'session-a' });
  parseAssistantReply(initial);
  const next = await answerGuide('', 'próximo', initial.guide, { sessionId: 'session-a' });
  assert.equal(next.guide.stepId, 'passo-2');
  assert.equal((await answerGuide('', 'não encontrei', initial.guide, { sessionId: 'session-a' })).escalation.guideId, guide.guideId);
  assert.match((await answerGuide('', 'pausar', initial.guide, { sessionId: 'session-a' })).answer, /pausado/);
  assert.equal((await answerGuide('', 'próximo', initial.guide, { sessionId: 'session-b' })).found, false);
});
test('generation caches successful guide and falls back for invalid candidate', async () => {
  let calls = 0;
  const client = { responses: { create: async (payload) => { calls++; return { status: 'completed', output_text: JSON.stringify(payload.text?.format?.type === 'json_schema' ? { mentionsSource: false, unsupportedAction: false } : { initialStepId: guide.initialStepId, steps: guide.steps }), usage: { input_tokens: 1, output_tokens: 1 } }; } } };
  const options = { sessionId: 'cache-session', productMap: map, budget: await budget() };
  const sources = [{ title: 'Procedimento', path: '/docs', productActions: [{ route: '/atendimento' }], documentedSteps: [step.text] }];
  assert.ok((await generateGuide('', 'Como abrir?', sources, client, options)).generatedGuide);
  assert.ok((await generateGuide('', 'Como abrir?', sources, client, options)).generatedGuide);
  assert.equal(calls, 2);
  const changedMap = { ...map, revision: 2 };
  assert.ok((await generateGuide('', 'Como abrir?', sources, client, { ...options, productMap: changedMap })).generatedGuide);
  assert.equal(calls, 4, 'map revision invalidates cache');
  assert.equal(await generateGuide('', 'Ambiguous', sources, client, { ...options, productMap: { ...map, elements: [...map.elements, ...map.elements] } }), null);
  for (const candidate of [ { ...guide.steps[1], locator: { kind: 'button', name: 'Fake' } }, { ...guide.steps[1], route: '/fake' } ]) {
    const bad = { responses: { create: async () => ({ status: 'completed', output_text: JSON.stringify({ initialStepId: 'passo-1', steps: [{ ...candidate, stepId: 'passo-1' }] }), usage: { input_tokens: 1, output_tokens: 1 } }) } };
    assert.equal(await generateGuide('', `invalid-${calls++}`, sources, bad, options), null);
  }
});
test('feedback preserves guide identity and counters; report ranks generated votes', async () => {
  const input = { type: 'assistant', value: 'up', path: null, guideId: guide.guideId, stepId: 'passo-1', guideTargets: { missing: 2, ambiguous: 1 } };
  assert.deepEqual(normalizeFeedback(input).guideTargets, input.guideTargets);
  for (const stepId of ['sk-proj-fakesecret012345678901234567890', '11987654321']) assert.throws(() => normalizeFeedback({ ...input, stepId }), /Feedback inválido/);
  assert.throws(() => normalizeFeedback({ ...input, guideTargets: { missing: -1, ambiguous: 0 } }), /Feedback inválido/);
  const file = join(await temp('guide-feedback-'), 'events.jsonl');
  await saveFeedback(file, input);
  assert.equal((await summarizeFeedback(file)).generatedGuides.mostRated[0].guideId, guide.guideId);
});

test('assistant integration: invalid generated target returns documented text; valid guide is returned', async () => {
  const root = await temp('generated-assistant-');
  await mkdir(join(root, 'content/docs/docs'), { recursive: true });
  await writeFile(join(root, 'content/docs/docs/abrir.mdx'), `---
 title: Abrir atendimento
 description: Como abrir atendimento
---

1. Abra a tela.

<ProductAction id="abrir-atendimento" route="/atendimento" />
`);
  let target = 'Fake';
  const client = { responses: { create: async (payload) => ({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output_text: JSON.stringify(
    payload.text?.format?.type === 'json_object' ? { initialStepId: 'passo-1', steps: [{ ...guide.steps[1], stepId: 'passo-1', locator: { kind: 'button', name: target } }] }
    : payload.text?.format?.name === 'seguranca_resposta' ? { mentionsSource: false, unsupportedAction: false }
    : { answer: 'Siga os passos.', steps: [{ text: step.text }], sections: [], sources: ['/docs/abrir'], suggestions: [], found: true, resolution: 'complete', code: null }
  ) }) } };
  const options = { client, sessionId: 'integration', productMap: map, budget: await budget() };
  const invalid = await answerQuestion(root, 'Como abrir atendimento?', options);
  assert.equal(invalid.generatedGuide, undefined);
  assert.ok(invalid.steps.length);
  target = 'Abrir';
  const valid = await answerQuestion(root, 'Como abrir atendimento?', options);
  assert.ok(valid.generatedGuide);
  parseAssistantReply(valid);
  assert.equal(normalizeSessionEvent({ sessionId: 'session-123', origin: 'app', guideId: valid.guide.guideId, stepId: valid.guide.stepId, durationMs: 1, result: 'in_progress', path: '/assistente' }).guideId, valid.guide.guideId);
});
