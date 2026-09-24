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

const plain = (value) => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function intentOf(question, context) {
  const value = plain(question);
  if (/\b(?:robo|chatbot)\b/.test(value)) return 'create_robot';
  if (/\b(?:campanha|disparo)\b/.test(value)) return 'campaigns';
  if (/\btemplate\b/.test(value)) return 'templates';
  if (/\b(?:canal|qr|numero|conectar|meta|coexistencia|api oficial)\b/.test(value)) return 'connect_channel';
  if (/\b(?:cobranca|plano|credito|fatura)\b/.test(value)) return 'billing';
  if (/\b(?:usuario|usuarios)\b/.test(value)) return 'manage_users';
  // Permissão e acesso descrevem o sintoma, não a área. O módulo público só ajuda sem objeto explícito.
  const moduleIntent = {
    robots: 'create_robot', campaigns: 'campaigns', templates: 'templates',
    channels: 'connect_channel', billing: 'billing', users: 'manage_users',
  }[context?.module];
  if (moduleIntent) return moduleIntent;
  return 'get_help';
}

export function diagnoseState(question, context) {
  const value = plain(question);
  const intent = intentOf(question, context);
  if (/\b(?:cancelar|reembolso|alterar contrato|alterar plano|excluir conta|dados pessoais)\b/.test(value)) return { cause: 'sensitive_action' };
  if (/\b(?:sem permissao|nao tenho permissao|permissao negada|acesso negado|nao tenho acesso)\b/.test(value)) return { cause: 'permission' };
  if (/\b(?:erro|falha|travou|bug)\b/.test(value)) return { cause: 'bug_incident' };
  const relevantIncidents = {
    create_robot: ['robot'], manage_users: [], campaigns: ['message_delivery'],
    templates: [], connect_channel: ['channel_outage', 'message_delivery'], billing: ['billing'], get_help: [],
  }[intent];
  if (context?.incidents?.some((item) => relevantIncidents.includes(item))) return { cause: 'bug_incident' };
  if (intent === 'connect_channel') {
    if (/\b(?:meta|coexistencia|api oficial)\b/.test(value) || context?.channels?.some((item) => item.kind === 'coexistence' && item.state === 'blocked')) return { cause: 'meta_coexistence' };
    if (context?.channels?.some((item) => item.state !== 'connected' && item.state !== 'unknown')) return { cause: 'channel_qr' };
  }
  if (intent === 'billing' && (['expired', 'limited'].includes(context?.plan) || context?.credit === 'empty')) return { cause: 'plan' };
  if (['campaigns', 'templates'].includes(intent) && ['rejected', 'pending'].includes(context?.templates)) return { cause: 'configuration' };
  return { cause: 'usage' };
}

export function diagnosticQuestion(question, context, diagnosis = diagnoseState(question, context)) {
  const intent = intentOf(question, context);
  const moduleName = {
    create_robot: 'Robôs', manage_users: 'Usuários', campaigns: 'Campanhas', templates: 'Templates',
    connect_channel: 'Canais', billing: 'Plano e cobrança', get_help: 'a área que você procura',
  }[intent];
  if (diagnosis.cause === 'sensitive_action') return 'Qual alteração você precisa solicitar ao atendimento?';
  if (diagnosis.cause === 'plan') return 'A tela de Plano e cobrança mostra algum aviso sobre limite ou vencimento?';
  if (diagnosis.cause === 'channel_qr') return 'Na tela de Canais, aparece um QR code ou um aviso de desconexão?';
  if (diagnosis.cause === 'meta_coexistence') return 'Na tela de Canais, aparece algum aviso da Meta ou de coexistência?';
  if (diagnosis.cause === 'configuration') return `Na tela de ${moduleName}, qual opção ou aviso aparece?`;
  if (diagnosis.cause === 'bug_incident') return `Na tela de ${moduleName}, qual aviso aparece quando você tenta continuar?`;
  if (diagnosis.cause === 'permission') return `Ao abrir ${moduleName}, aparece um aviso de acesso negado?`;
  return `Você vê ${moduleName} no menu lateral?`;
}

export function escalationFor(question, diagnosis, context, history) {
  const past = history.map(({ content }) => plain(content));
  const intent = intentOf(question, context);
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
