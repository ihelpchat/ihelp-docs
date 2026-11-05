import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { guideSchema } from '../conversation-v1.mjs';
import { widgetContextRoutes } from '../widget-context.mjs';

const frontend = process.argv[2];
assert.ok(frontend, 'Informe o checkout local do frontend para conferir os blobs do SHA fonte.');
const sourceSha = '730ec0c95c6653354f6ea532bddacfaf4cac9568';
const ids = ['recado-fora-do-horario', 'usuario-acesso', 'reconectar-canal-qr'];
const routes = new Set([...widgetContextRoutes, '/configuracoes/usuarios/novo']);
const outcomes = new Set(['complete', 'handoff', 'paused']);
const blobs = new Map();
for (const id of ids) {
  const raw = await readFile(new URL(`./${id}.json`, import.meta.url), 'utf8');
  const draft = JSON.parse(raw);
  assert.equal(draft.status, 'source-only-draft');
  assert.deepEqual(draft.publication, { editorialApproved: false, runtimeValidated: false, published: false });
  assert.equal(draft.source.sha, sourceSha);
  assert.equal(draft.consumption.publishedEngineCompatible, false);
  assert.equal(draft.consumption.automaticSideEffectsAllowed, false);
  const guide = guideSchema.parse(draft.guide);
  assert.equal(guide.guideId, id);
  assert.equal(guide.version, 2);
  assert.equal(guide.mode, 'treino');
  const steps = new Map(guide.steps.map((step) => [step.stepId, step]));
  assert.deepEqual(Object.keys(draft.transitionsByStep).sort(), [...steps.keys()].sort());
  assert.deepEqual(Object.keys(draft.evidenceByStep).sort(), [...steps.keys()].sort());
  const edges = new Map();
  for (const [stepId, step] of steps) {
    const transition = draft.transitionsByStep[stepId];
    assert.equal(Object.keys(transition).length, 1, `${id}/${stepId}: transição ambígua`);
    const destinations = [];
    const checkTarget = (target) => {
      assert.equal(Object.keys(target).length, 1);
      if (target.nextStepId) {
        assert.ok(steps.has(target.nextStepId), `${id}/${stepId}: próximo passo desconhecido`);
        destinations.push(target.nextStepId);
      } else assert.ok(outcomes.has(target.outcome), `${id}/${stepId}: outcome desconhecido`);
    };
    if (step.choices?.length) {
      assert.ok(transition.choices);
      assert.deepEqual(Object.keys(transition.choices).sort(), step.choices.map((choice) => choice.id).sort());
      for (const choice of step.choices) {
        const target = transition.choices[choice.id];
        if (choice.nextStepId) assert.equal(target.nextStepId, choice.nextStepId);
        else assert.equal(target.outcome, 'complete');
        checkTarget(target);
      }
    } else if (transition.continue) checkTarget(transition.continue);
    else {
      assert.ok(outcomes.has(transition.outcome));
      if (stepId === 'pedir-ajuda') assert.equal(transition.outcome, 'handoff');
      if (stepId === 'sem-celular') assert.equal(transition.outcome, 'paused');
    }
    edges.set(stepId, destinations);
    assert.ok(draft.evidenceByStep[stepId].length);
    for (const evidence of draft.evidenceByStep[stepId]) {
      assert.match(evidence.path, /^src\/features\/configurations\/[A-Za-z0-9/_.-]+$/u);
      assert.ok(Number.isSafeInteger(evidence.line) && evidence.line > 0);
      if (!blobs.has(evidence.path)) blobs.set(evidence.path, execFileSync('git', ['--no-pager', 'show', `${sourceSha}:${evidence.path}`], { cwd: frontend, encoding: 'utf8' }).split('\n'));
      assert.ok(blobs.get(evidence.path)[evidence.line - 1]?.includes(evidence.fragment), `${id}/${stepId}: referência não corresponde ao blob fixado`);
    }
  }
  const reached = new Set();
  const visit = (stepId, path = new Set()) => {
    assert.ok(!path.has(stepId), `${id}: ciclo no roteiro`);
    reached.add(stepId);
    for (const next of edges.get(stepId)) visit(next, new Set([...path, stepId]));
  };
  visit(guide.initialStepId);
  assert.equal(reached.size, steps.size, `${id}: passo inacessível`);
  for (const [stepId, navigation] of Object.entries(draft.navigationByStep)) {
    assert.ok(steps.has(stepId));
    if (navigation.route) assert.ok(routes.has(navigation.route));
    else {
      assert.equal(navigation.routeTemplate, '/configuracoes/canais/:idRef');
      assert.equal(navigation.requiresUserSelection, true);
    }
    assert.ok(['button', 'heading', 'field'].includes(navigation.anchor.kind));
  }
  console.log(`${id}: v2 treino; ${steps.size} passos; grafo completo, referências no SHA e publicação desativada`);
}
console.log(`SOURCE-ONLY: ${ids.length} drafts, ${blobs.size} blobs de produto; nenhuma jornada runtime executada.`);
