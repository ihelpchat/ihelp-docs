import { z } from 'zod/v4';
import actions from './product-actions.json' with { type: 'json' };
import canonicalGuideIds from './guide-ids.json' with { type: 'json' };

export const schemaVersion = 1;
export const legacyGuideAliases = Object.freeze({
  'importar-contatos': 'importar-contatos',
  'abrir-robos': 'robo-de-atendimento',
  'abrir-usuarios': 'usuario-acesso',
  'abrir-canais': 'reconectar-canal-qr',
  'abrir-campanhas': 'campanhas',
  'abrir-departamentos': 'permissoes-departamentos',
  'abrir-atendimento': 'arquivos',
  'abrir-crm': 'crm',
});
const guideIds = new Set(canonicalGuideIds);
if (Object.values(legacyGuideAliases).some((guideId) => !guideIds.has(guideId))) throw new Error('alias de guia desconhecido');
const actionIds = new Set(Object.keys(actions));
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/);
const knownGuideId = z.enum([...guideIds]);
const actionId = z.enum([...actionIds]);
const mode = z.enum(['real', 'treino']);
const stateSchema = z.object({
  guideId: knownGuideId,
  stepId: id,
  version: z.number().int().positive(),
  mode,
  pendingChoiceId: id.optional(),
  choiceId: id.optional(),
}).strict();
const choiceSchema = z.object({ id, label: z.string().trim().min(1).max(100), nextStepId: id.optional() }).strict();
const stepSchema = z.object({
  stepId: id,
  text: z.string().trim().min(1).max(1000),
  actionId: actionId.optional(),
  choices: z.array(choiceSchema).max(6).optional(),
}).strict();
export const guideSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  guideId: knownGuideId,
  version: z.number().int().positive(),
  mode,
  initialStepId: id,
  steps: z.array(stepSchema).min(1).max(40),
}).strict().superRefine((guide, context) => {
  const ids = new Set(guide.steps.map((step) => step.stepId));
  if (ids.size !== guide.steps.length) context.addIssue({ code: 'custom', message: 'stepId duplicado' });
  if (!ids.has(guide.initialStepId)) context.addIssue({ code: 'custom', message: 'initialStepId desconhecido' });
  for (const step of guide.steps) {
    const choices = step.choices ?? [];
    if (new Set(choices.map((choice) => choice.id)).size !== choices.length) context.addIssue({ code: 'custom', message: 'choice id duplicado' });
    for (const choice of choices) if (choice.nextStepId && !ids.has(choice.nextStepId)) context.addIssue({ code: 'custom', message: 'nextStepId desconhecido' });
  }
});
export const productActionSchema = z.object({
  id: actionId,
  label: z.string(),
  route: z.string(),
  target: z.string().optional(),
}).strict().superRefine((action, context) => {
  const expected = actions[action.id];
  if (!expected || action.label !== expected.label || action.route !== expected.route || action.target !== expected.target) {
    context.addIssue({ code: 'custom', message: 'ação fora do catálogo' });
  }
});
export const assistantRequestSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  question: z.string().trim().min(1).max(500),
  guide: stateSchema.optional(),
}).strict();
export const assistantReplySchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  answer: z.string().trim().min(1),
  guide: stateSchema.optional(),
  actions: z.array(productActionSchema).max(8).optional(),
}).strict();

export const parseGuide = (value) => guideSchema.parse(value);
export const parseAssistantRequest = (value) => assistantRequestSchema.parse(value);
export const parseAssistantReply = (value) => assistantReplySchema.parse(value);
export const parseProductAction = (value) => productActionSchema.parse(value);
export function resolveGuideId(value) {
  if (typeof value !== 'string') return null;
  if (Object.hasOwn(legacyGuideAliases, value)) return legacyGuideAliases[value];
  return guideIds.has(value) ? value : null;
}
