import { z } from 'zod/v4';
import actions from './product-actions.json' with { type: 'json' };
import canonicalGuideIds from './guide-ids.json' with { type: 'json' };
import { resolveCatalogAction } from './catalog-action.mjs';

export const schemaVersion = 1;
export const legacyGuideAliases = Object.freeze({
  'importar-contatos': null,
  'abrir-robos': null,
  'abrir-usuarios': 'usuario-acesso',
  'abrir-canais': null,
  'abrir-campanhas': 'campanhas',
  'abrir-departamentos': 'permissoes-departamentos',
  'abrir-atendimento': 'arquivos',
  'abrir-crm': 'crm',
});
const guideIds = new Set(canonicalGuideIds);
if (Object.values(legacyGuideAliases).some((guideId) => guideId !== null && !guideIds.has(guideId))) throw new Error('alias de guia desconhecido');
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
  pendingChoice: id.optional(),
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
  label: z.string().optional(),
  route: z.string(),
  target: z.string().optional(),
}).strict().superRefine((action, context) => {
  if (!resolveCatalogAction({ id: action.id, route: action.route, label: action.label, target: action.target })) {
    context.addIssue({ code: 'custom', message: 'ação fora do catálogo' });
  }
});
const historySchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000).transform((content) => content.slice(0, 3_000)) }).strict();
const widgetContextSchema = z.object({
  surface: z.enum(['faq', 'app']).optional(),
  route: z.enum([...new Set(Object.values(actions).map((action) => action.route))]).optional(),
  module: z.enum(['robots', 'users', 'channels', 'billing', 'campaigns', 'templates', 'conversations', 'settings']).optional(),
  screen: z.enum(['list', 'create', 'edit', 'detail', 'connection', 'qr', 'unknown']).optional(),
  role: z.enum(['owner', 'admin', 'manager', 'agent', 'unknown']).optional(),
  permissions: z.array(z.enum(['robots.read', 'robots.create', 'users.read', 'users.manage', 'channels.read', 'channels.manage', 'billing.read', 'campaigns.read', 'campaigns.create', 'templates.read', 'templates.manage'])).max(12).optional(),
  plan: z.enum(['trial', 'active', 'expired', 'limited', 'unknown']).optional(),
  channels: z.array(z.object({ kind: z.enum(['whatsapp', 'official_api', 'coexistence']), state: z.enum(['connected', 'disconnected', 'qr_pending', 'blocked', 'syncing', 'unknown']) }).strict()).max(5).optional(),
  credit: z.enum(['available', 'low', 'empty', 'unknown']).optional(),
  templates: z.enum(['none', 'pending', 'approved', 'rejected', 'unknown']).optional(),
  incidents: z.array(z.enum(['channel_outage', 'message_delivery', 'billing', 'robot', 'app'])).max(5).optional(),
}).strict();
const diagnosis = z.enum(['usage', 'configuration', 'permission', 'plan', 'channel_qr', 'meta_coexistence', 'bug_incident', 'sensitive_action']);
const sourceSchema = z.object({
  title: z.string(), path: z.string().regex(/^\/(?!\/)[a-z0-9/_-]+$/i),
  kind: z.enum(['Ajuda', 'FAQ', 'API', 'Tutorial', 'Novidade']).optional(),
  excerpt: z.string().optional(),
  media: z.object({ kind: z.enum(['video', 'tango']), url: z.string(), embedUrl: z.string().optional() }).strict().optional(),
}).strict();
export const assistantRequestSchema = z.object({
  schemaVersion: z.literal(schemaVersion).optional(),
  question: z.string().trim().min(1).max(500),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/).optional(),
  history: z.array(historySchema).max(6).optional(),
  scope: z.enum(['Tudo', 'Ajuda e FAQ', 'API', 'Tutoriais', 'Novidades']).optional(),
  page: z.object({ path: z.string().regex(/^\/(?!\/)[a-z0-9/_-]+$/i), title: z.string().max(200) }).strict().optional(),
  widgetContext: widgetContextSchema.optional(),
  guide: stateSchema.optional(),
}).strict();
export const assistantReplySchema = z.object({
  schemaVersion: z.literal(schemaVersion).optional(),
  answer: z.string().trim().min(1),
  sections: z.array(z.object({ title: z.string(), items: z.array(z.string()) }).strict()).optional(),
  steps: z.array(z.object({
    text: z.string(), action: productActionSchema.optional(),
    image: z.object({ src: z.string(), alt: z.string() }).strict().optional(),
  }).strict()).optional(),
  code: z.object({ language: z.string(), content: z.string() }).strict().nullable().optional(),
  sources: z.array(sourceSchema).optional(),
  suggestions: z.array(z.string()).optional(),
  resolution: z.enum(['complete', 'partial', 'not_found']).optional(),
  found: z.boolean().optional(),
  diagnosis: z.object({ cause: diagnosis }).strict().optional(),
  escalation: z.object({
    intent: z.enum(['create_robot', 'manage_users', 'connect_channel', 'billing', 'campaigns', 'templates', 'departments', 'files', 'crm', 'get_help']),
    diagnosis,
    state: widgetContextSchema.optional(),
    attempts: z.array(z.enum(['documented_guide', 'reported_stuck'])),
  }).strict().optional(),
  guide: stateSchema.optional(),
  actions: z.array(productActionSchema).max(8).optional(),
  model: z.string().optional(),
}).strict();

export const parseGuide = (value) => guideSchema.parse(value);
export const parseAssistantRequest = (value) => assistantRequestSchema.parse(value);
export const parseAssistantReply = (value) => {
  const reply = assistantReplySchema.parse(value);
  return {
    ...reply,
    ...(reply.steps ? { steps: reply.steps.map((step) => step.action ? { ...step, action: resolveCatalogAction(step.action) } : step) } : {}),
    ...(reply.actions ? { actions: reply.actions.map(resolveCatalogAction) } : {}),
  };
};
export const parseProductAction = (value) => {
  if (value && typeof value === 'object' && Object.keys(value).some((key) => !['id', 'label', 'route', 'target'].includes(key))) productActionSchema.parse(value);
  return resolveCatalogAction(value);
};
export function resolveGuideLink(value) {
  if (typeof value !== 'string') return null;
  if (Object.hasOwn(legacyGuideAliases, value)) {
    const guideId = legacyGuideAliases[value];
    return guideId === null ? { kind: 'navigation', actionId: value } : { kind: 'guide', guideId };
  }
  return guideIds.has(value) ? { kind: 'guide', guideId: value } : null;
}
export function resolveGuideId(value) {
  const resolved = resolveGuideLink(value);
  return resolved?.kind === 'guide' ? resolved.guideId : null;
}
