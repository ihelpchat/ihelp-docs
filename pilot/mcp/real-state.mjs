import { catalogActions } from './product-actions.mjs';

const choices = {
  surface: ['faq', 'app'], module: ['robots', 'users', 'channels', 'billing', 'campaigns', 'templates', 'conversations', 'settings'],
  screen: ['list', 'create', 'edit', 'detail', 'connection', 'qr', 'unknown'],
  role: ['owner', 'admin', 'manager', 'agent', 'unknown'],
  plan: ['trial', 'active', 'expired', 'limited', 'unknown'],
  credit: ['available', 'low', 'empty', 'unknown'],
  templates: ['none', 'pending', 'approved', 'rejected', 'unknown'],
};
const permissions = new Set(['robots.read', 'robots.create', 'users.read', 'users.manage', 'channels.read', 'channels.manage', 'billing.read', 'campaigns.read', 'campaigns.create', 'templates.read', 'templates.manage']);
const channelKinds = new Set(['whatsapp', 'official_api', 'coexistence']);
const channelStates = new Set(['connected', 'disconnected', 'qr_pending', 'blocked', 'syncing', 'unknown']);
const incidentKinds = new Set(['channel_outage', 'message_delivery', 'billing', 'robot', 'app']);
const routes = new Set(catalogActions().map(({ route }) => route));
const keys = new Set(['surface', 'route', 'module', 'screen', 'role', 'permissions', 'plan', 'channels', 'credit', 'templates', 'incidents']);
const own = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const allowed = (value, list) => value === undefined || list.includes(value);

/** Client supplied state is a bounded hint, never an authorization or verified server fact. */
export function sanitizeWidgetContext(value) {
  if (value === undefined || value === null) return undefined;
  if (!own(value) || Object.keys(value).some((key) => !keys.has(key)) || JSON.stringify(value).length > 1500) return undefined;
  for (const key of ['surface', 'module', 'screen', 'role', 'plan', 'credit', 'templates']) if (!allowed(value[key], choices[key])) return undefined;
  if (value.route !== undefined && (typeof value.route !== 'string' || !routes.has(value.route))) return undefined;
  if (value.permissions !== undefined && (!Array.isArray(value.permissions) || value.permissions.length > 12 || value.permissions.some((item) => !permissions.has(item)))) return undefined;
  if (value.incidents !== undefined && (!Array.isArray(value.incidents) || value.incidents.length > 5 || value.incidents.some((item) => !incidentKinds.has(item)))) return undefined;
  if (value.channels !== undefined && (!Array.isArray(value.channels) || value.channels.length > 5 || value.channels.some((item) => !own(item) || Object.keys(item).some((key) => !['kind', 'state'].includes(key)) || !channelKinds.has(item.kind) || !channelStates.has(item.state)))) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? item.map((entry) => own(entry) ? { ...entry } : entry) : item]));
}

export function diagnoseState(question, context) {
  const value = String(question).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/\b(?:cancelar|reembolso|alterar contrato|alterar plano|excluir conta|dados pessoais)\b/.test(value)) return { cause: 'sensitive_action' };
  if (context?.incidents?.length) return { cause: 'bug_incident' };
  if (/\b(?:meta|coexistencia|api oficial|whatsapp business)\b/.test(value) || context?.channels?.some((item) => item.kind === 'coexistence' && item.state === 'blocked')) return { cause: 'meta_coexistence' };
  if (/\b(?:qr|canal|numero|conexao|conectar)\b/.test(value) && context?.channels?.some((item) => item.state !== 'connected' && item.state !== 'unknown')) return { cause: 'channel_qr' };
  if (context?.plan === 'expired' || context?.plan === 'limited' || (/\b(?:plano|credito|cobranca)\b/.test(value) && context?.credit === 'empty')) return { cause: 'plan' };
  if (/\b(?:robo|chatbot)\b/.test(value) && context?.permissions && !context.permissions.includes('robots.create')) return { cause: 'permission' };
  if (/\b(?:usuario|acesso|permissao)\b/.test(value) && context?.permissions && !context.permissions.includes('users.manage')) return { cause: 'permission' };
  if (/\b(?:campanha|disparo)\b/.test(value) && context?.permissions && !context.permissions.includes('campaigns.create')) return { cause: 'permission' };
  if (context?.templates === 'rejected' || (/\b(?:campanha|template)\b/.test(value) && context?.templates === 'pending')) return { cause: 'configuration' };
  if (/\b(?:erro|falha|travou|bug)\b/.test(value)) return { cause: 'bug_incident' };
  return { cause: 'usage' };
}

export function escalationFor(question, diagnosis, context, history) {
  const value = String(question).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const past = history.map(({ content }) => content.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase());
  const topic = past.find((item) => /\b(?:robo|chatbot|usuario|canal|qr|cobranca|plano|campanha|template)\b/.test(item)) ?? value;
  const intent = /\b(?:robo|chatbot)\b/.test(topic) ? 'create_robot'
    : /\b(?:usuario|acesso|permissao)\b/.test(topic) ? 'manage_users'
    : /\b(?:canal|qr|numero|conectar)\b/.test(topic) ? 'connect_channel'
    : /\b(?:cobranca|plano|credito)\b/.test(topic) ? 'billing'
    : /\b(?:campanha|disparo)\b/.test(topic) ? 'campaigns'
    : /\btemplate\b/.test(topic) ? 'templates' : 'get_help';
  return {
    intent,
    diagnosis: diagnosis.cause,
    ...(context ? { state: context } : {}),
    attempts: [...new Set([
      ...(past.some((item) => /\b(?:guie|guiar|passo|criar|como)\b/.test(item)) ? ['documented_guide'] : []),
      ...(past.some((item) => /nao encontrei|preciso de ajuda/.test(item)) ? ['reported_stuck'] : []),
    ])],
  };
}
