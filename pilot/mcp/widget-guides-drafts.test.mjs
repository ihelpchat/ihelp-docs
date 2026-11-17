import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { draftGuideSchema } from '../architecture/widget-guides-drafts/schema.mjs';
import { guideSchema } from '../architecture/conversation-v1.mjs';

const ids = ['iniciar-atendimento', 'transferir-atendimento', 'finalizar-atendimento'];
for (const id of ids) {
  const draft = JSON.parse(await readFile(new URL(`../architecture/widget-guides-drafts/${id}.json`, import.meta.url)));
  assert.equal(draftGuideSchema.safeParse({ ...draft.guide, steps: [...draft.guide.steps, draft.guide.steps[0]] }).success, false, 'schema de draft preserva rejeição de stepId duplicado');
  assert.deepEqual(draft.publication, { editorialApproved: false, runtimeValidated: false, published: false });
  assert.equal(guideSchema.safeParse(draft.guide).success, false, 'ID novo não entra na allowlist publicada');
  const guide = draftGuideSchema.parse({ ...draft.guide, transitions: 'explicit', steps: draft.guide.steps.map((step) => {
    const transition = draft.transitionsByStep[step.stepId];
    return { ...step, ...(step.choices ? { choices: step.choices.map((choice) => ({ ...choice, ...transition.choices[choice.id] })) } : { next: { outcome: transition.outcome } }) };
  }) });
  assert.equal(guide.transitions, 'explicit');
  for (const step of guide.steps) {
    assert.ok([...step.text].length <= 200, `${id}/${step.stepId}: texto longo`);
    if (['pedir-ajuda', 'pausar', 'conferir-resultado'].includes(step.stepId)) continue;
    assert.equal(step.choices.find((choice) => choice.id === 'bloqueado')?.nextStepId, 'pedir-ajuda');
    assert.equal(step.choices.find((choice) => choice.id === 'pausar')?.nextStepId, 'pausar');
    assert.ok(!step.choices.some((choice) => choice.outcome === 'complete'), 'ação não confirma conclusão');
  }
  assert.equal(guide.steps.find((step) => step.stepId === 'pedir-ajuda').next.outcome, 'handoff');
  assert.equal(guide.steps.find((step) => step.stepId === 'pausar').next.outcome, 'paused');
  assert.equal(guide.steps.find((step) => step.stepId === 'conferir-resultado').choices.find((choice) => choice.id === 'conferi').outcome, 'complete');
}
const manifest = JSON.parse(await readFile(new URL('../public/guides/manifest.json', import.meta.url)));
assert.equal(manifest.current, '7bcb2036a4b2');
const catalog = await readFile(new URL(`../public/guides/${manifest.current}/catalog.json`, import.meta.url), 'utf8');
assert.equal(JSON.parse(catalog).contentSha256, '7bcb2036a4b208f325894ecbe0451374ea596b7cea732a053faef1d8f14f1b99');
for (const id of ids) assert.ok(!catalog.includes(`"${id}"`), `${id}: rascunho entrou no pacote publicado`);
console.log('widget-guides-drafts: 3 rascunhos, ações com bloqueio/pausa, confirmação e pacote preservado');
