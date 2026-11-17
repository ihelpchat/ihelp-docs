import { guideSchema, guideStepRoutes } from '../architecture/conversation-v1.mjs';

// Converte um rascunho v2 de `architecture/widget-guides-drafts` no formato publicado com grafo
// explícito: `transitionsByStep` vira `next`/`outcome` por passo, e títulos, rotas e pré-requisitos
// passam a fazer parte do roteiro. Âncoras e evidências ficam no rascunho e na página.
const routes = new Set(guideStepRoutes);
const target = (value) => value.nextStepId ? { nextStepId: value.nextStepId } : { outcome: value.outcome };

export function publishedGuideFromDraft(draft, { mode = draft.guide.mode } = {}) {
  const steps = draft.guide.steps.map((step) => {
    const transition = draft.transitionsByStep[step.stepId];
    if (!transition) throw new Error(`${step.stepId}: transição ausente no rascunho`);
    const route = draft.navigationByStep?.[step.stepId]?.route;
    return {
      stepId: step.stepId,
      ...(draft.titlesByStep?.[step.stepId] ? { title: draft.titlesByStep[step.stepId] } : {}),
      text: step.text,
      ...(step.actionId ? { actionId: step.actionId } : {}),
      ...(route && routes.has(route) ? { route } : {}),
      ...(step.choices?.length
        ? { choices: step.choices.map((choice) => ({ id: choice.id, label: choice.label, ...target(transition.choices[choice.id]) })) }
        : { next: transition.continue ? target(transition.continue) : { outcome: transition.outcome } }),
    };
  });
  return guideSchema.parse({
    schemaVersion: draft.guide.schemaVersion,
    guideId: draft.guide.guideId,
    version: draft.guide.version,
    mode,
    initialStepId: draft.guide.initialStepId,
    transitions: 'explicit',
    ...(draft.prerequisites?.length ? { prerequisites: draft.prerequisites } : {}),
    steps,
  });
}
