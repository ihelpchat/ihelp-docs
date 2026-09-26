import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import type { AssistantRequestV1 } from './conversation-contract.generated';
export type { ActionId, GuideId, GuideV1, AssistantRequestV1, AssistantReplyV1, ProductActionV1 } from './conversation-contract.generated';

/**
 * Cliente do assistente de IA.
 *
 * O site é exportado como estático, então a IA roda fora dele: qualquer serviço que implemente o
 * contrato abaixo em `NEXT_PUBLIC_ASSISTANT_URL` funciona (hoje, `mcp/http.mjs` → `/assistant`, com GPT).
 * Sem a variável, a interface mostra o estado “não conectado” e nunca inventa resposta.
 *
 * Pedido  (POST JSON): { question, history?: {role, content}[], scope?, page?: { path, title } }
 * Resposta (JSON):     { answer, steps?, code?: { language, content } | null,
 *                        sources?: { title, path, kind?, excerpt? }[], suggestions?, resolution?, found? }
 */

export const assistantEndpoint = process.env.NEXT_PUBLIC_ASSISTANT_URL?.trim() ?? '';
export const assistantEnabled = assistantEndpoint.length > 0;

export const assistantScopes = ['Tudo', 'Ajuda e FAQ', 'API', 'Tutoriais', 'Novidades'] as const;
export type AssistantScope = (typeof assistantScopes)[number];

export type SourceKind = 'Ajuda' | 'FAQ' | 'API' | 'Tutorial' | 'Novidade';

export type AssistantMedia = { kind: 'video' | 'tango'; url: string; embedUrl?: string };
export type AssistantSource = { title: string; path: string; kind: SourceKind; excerpt?: string; media?: AssistantMedia };
export type AssistantSection = { title: string; items: string[] };
export type AssistantProductAction = { id: string; label: string; route: string; target?: string };
export type AssistantImage = { src: string; alt: string };
export type AssistantStep = { text: string; action?: AssistantProductAction; image?: AssistantImage };
export type AssistantResolution = 'complete' | 'partial' | 'not_found';
export type AssistantEscalation = {
  intent: 'create_robot' | 'manage_users' | 'connect_channel' | 'billing' | 'campaigns' | 'templates' | 'departments' | 'files' | 'crm' | 'get_help';
  diagnosis: 'usage' | 'configuration' | 'permission' | 'plan' | 'channel_qr' | 'meta_coexistence' | 'bug_incident' | 'sensitive_action';
  state?: Record<string, unknown>;
  attempts: ('documented_guide' | 'reported_stuck')[];
};

export type AssistantReply = {
  answer: string;
  sections: AssistantSection[];
  steps: AssistantStep[];
  code: { language: string; content: string } | null;
  sources: AssistantSource[];
  suggestions: string[];
  resolution: AssistantResolution;
  found: boolean;
  escalation?: AssistantEscalation;
};

export type AssistantHistoryItem = { role: 'user' | 'assistant'; content: string };

export type AssistantRequest = AssistantRequestV1;

function stateSummary(state: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (field: string, labels: Record<string, string>, title: string) => {
    const value = state[field];
    if (typeof value === 'string' && labels[value]) parts.push(`${title}: ${labels[value]}`);
  };
  add('module', { robots: 'Robôs', users: 'Usuários', channels: 'Canais', billing: 'Plano e cobrança', campaigns: 'Campanhas', templates: 'Templates', conversations: 'Atendimentos', settings: 'Configurações' }, 'área');
  add('screen', { list: 'lista', create: 'criação', edit: 'edição', detail: 'detalhes', connection: 'conexão', qr: 'QR code', unknown: 'não identificada' }, 'tela');
  add('role', { owner: 'titular', admin: 'administrador', manager: 'gestor', agent: 'atendente', unknown: 'não identificado' }, 'perfil');
  add('plan', { trial: 'trial', active: 'ativo', expired: 'expirado', limited: 'limitado', unknown: 'não identificado' }, 'plano informado');
  add('credit', { available: 'disponível', low: 'baixo', empty: 'sem crédito', unknown: 'não identificado' }, 'crédito');
  add('templates', { none: 'nenhum', pending: 'aguardando aprovação', approved: 'aprovado', rejected: 'rejeitado', unknown: 'não identificado' }, 'templates');
  const permissionLabels: Record<string, string> = {
    'robots.read': 'ver robôs', 'robots.create': 'criar robôs', 'users.read': 'ver usuários', 'users.manage': 'gerenciar usuários',
    'channels.read': 'ver canais', 'channels.manage': 'gerenciar canais', 'billing.read': 'ver cobrança',
    'campaigns.read': 'ver campanhas', 'campaigns.create': 'criar campanhas', 'templates.read': 'ver templates', 'templates.manage': 'gerenciar templates',
  };
  if (Array.isArray(state.permissions)) {
    const permissions = state.permissions.flatMap((item) => typeof item === 'string' && permissionLabels[item] ? [permissionLabels[item]] : []);
    if (permissions.length) parts.push(`permissões informadas: ${permissions.join(', ')}`);
  }
  const kindLabels: Record<string, string> = { whatsapp: 'WhatsApp', official_api: 'API Oficial', coexistence: 'coexistência' };
  const channelLabels: Record<string, string> = { connected: 'conectado', disconnected: 'desconectado', qr_pending: 'aguardando QR code', blocked: 'bloqueado', syncing: 'sincronizando', unknown: 'não identificado' };
  if (Array.isArray(state.channels)) {
    const channels = state.channels.flatMap((item) => item && typeof item === 'object' && kindLabels[item.kind] && channelLabels[item.state] ? [`${kindLabels[item.kind]} ${channelLabels[item.state]}`] : []);
    if (channels.length) parts.push(`canais: ${channels.join(', ')}`);
  }
  const incidentLabels: Record<string, string> = { channel_outage: 'indisponibilidade de canal', message_delivery: 'entrega de mensagens', billing: 'cobrança', robot: 'robô', app: 'aplicativo' };
  if (Array.isArray(state.incidents)) {
    const incidents = state.incidents.flatMap((item) => typeof item === 'string' && incidentLabels[item] ? [incidentLabels[item]] : []);
    if (incidents.length) parts.push(`incidentes informados: ${incidents.join(', ')}`);
  }
  return parts.join('; ');
}

export function supportMessageFor(reply: AssistantReply): string {
  if (!reply.escalation) return 'Olá! Consultei a Central de Ajuda do iHelp e preciso de atendimento.';
  const intentLabels: Record<AssistantEscalation['intent'], string> = {
    create_robot: 'criar robô', manage_users: 'gerenciar usuários', connect_channel: 'conectar canal',
    billing: 'cobrança ou plano', campaigns: 'campanhas', templates: 'templates',
    departments: 'permissões e departamentos', files: 'arquivos no atendimento', crm: 'CRM e pipeline', get_help: 'obter ajuda',
  };
  const diagnosisLabels: Record<AssistantEscalation['diagnosis'], string> = {
    usage: 'dúvida de uso', configuration: 'possível questão de configuração', permission: 'possível questão de permissão',
    plan: 'possível questão de plano ou crédito', channel_qr: 'possível questão de conexão ou QR code',
    meta_coexistence: 'possível questão com a Meta ou coexistência', bug_incident: 'possível problema no aplicativo ou incidente',
    sensitive_action: 'solicitação que exige atendimento humano',
  };
  const attemptLabels: Record<AssistantEscalation['attempts'][number], string> = {
    documented_guide: 'seguiu as orientações da Central de Ajuda', reported_stuck: 'não encontrou o passo esperado',
  };
  const state = reply.escalation.state ? stateSummary(reply.escalation.state) : '';
  return [
    'Olá! Preciso de atendimento no iHelp.',
    `Intenção: ${intentLabels[reply.escalation.intent]}.`,
    `Diagnóstico inicial: ${diagnosisLabels[reply.escalation.diagnosis]}.`,
    ...(state ? [`Estado informado pelo aplicativo, não confirmado pelo servidor: ${state}.`] : []),
    `Tentativas: ${reply.escalation.attempts.map((item) => attemptLabels[item]).join('; ') || 'nenhuma registrada'}.`,
  ].join('\n');
}

export class AssistantError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export function kindOf(path: string): SourceKind {
  if (path.startsWith('/api')) return 'API';
  if (path.startsWith('/tutoriais')) return 'Tutorial';
  if (path.startsWith('/blog')) return 'Novidade';
  if (path.startsWith('/docs/principais-duvidas')) return 'FAQ';
  return 'Ajuda';
}

function strings(value: unknown, max: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, max) : [];
}

function safeAction(value: unknown): AssistantProductAction | undefined {
  return resolveCatalogAction(value) ?? undefined;
}

function steps(value: unknown): AssistantStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ text: item.trim() }];
    if (!item || typeof item !== 'object' || typeof (item as { text?: unknown }).text !== 'string') return [];
    const raw = item as { text: string; action?: unknown; image?: unknown };
    const text = raw.text.trim();
    if (!text) return [];
    const action = safeAction(raw.action);
    const image = safeImage(raw.image);
    return [{ text, ...(action ? { action } : {}), ...(image ? { image } : {}) }];
  });
}

function safeImage(value: unknown): AssistantImage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const image = value as Record<string, unknown>;
  if (typeof image.src !== 'string' || !/^\/img\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp|gif)$/i.test(image.src)) return undefined;
  if (typeof image.alt !== 'string' || !image.alt.trim()) return undefined;
  return { src: image.src, alt: image.alt.trim().slice(0, 200) };
}

function safeMedia(value: unknown): AssistantMedia | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const media = value as Record<string, unknown>;
  if (typeof media.url !== 'string') return undefined;
  if (media.kind === 'tango') {
    if (!/^https:\/\/app\.tango\.us\/app\/workflow\/[A-Za-z0-9-]+\/?$/.test(media.url)) return undefined;
    const embedUrl = typeof media.embedUrl === 'string' && /^https:\/\/app\.tango\.us\/app\/embed\/[A-Za-z0-9-]+\/?$/.test(media.embedUrl) ? media.embedUrl : undefined;
    return { kind: 'tango', url: media.url, ...(embedUrl ? { embedUrl } : {}) };
  }
  if (media.kind !== 'video') return undefined;
  if (/^\/videos\/[A-Za-z0-9/_-]+\.mp4$/.test(media.url) && media.embedUrl === media.url) return { kind: 'video', url: media.url, embedUrl: media.url };
  if (typeof media.embedUrl !== 'string') return undefined;
  if (/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/.test(media.embedUrl) && /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]{11}$/.test(media.url)) return { kind: 'video', url: media.url, embedUrl: media.embedUrl };
  const tella = media.url.match(/^https:\/\/www\.tella\.tv\/video\/([A-Za-z0-9_-]+)(?:\/(?:view|embed))?\/?$/);
  if (tella && media.embedUrl === `https://www.tella.tv/video/${tella[1]}/embed`) return { kind: 'video', url: media.url, embedUrl: media.embedUrl };
  return undefined;
}

const escalationIntents = ['create_robot', 'manage_users', 'connect_channel', 'billing', 'campaigns', 'templates', 'departments', 'files', 'crm', 'get_help'] as const;
const escalationDiagnoses = ['usage', 'configuration', 'permission', 'plan', 'channel_qr', 'meta_coexistence', 'bug_incident', 'sensitive_action'] as const;
const escalationAttempts = ['documented_guide', 'reported_stuck'] as const;
function safeEscalation(value: unknown): AssistantEscalation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (!escalationIntents.includes(raw.intent as AssistantEscalation['intent']) || !escalationDiagnoses.includes(raw.diagnosis as AssistantEscalation['diagnosis'])) return undefined;
  const state = raw.state && typeof raw.state === 'object' && !Array.isArray(raw.state) ? raw.state as Record<string, unknown> : undefined;
  const safeState: Record<string, unknown> = {};
  if (state) {
    for (const [key, allowed] of Object.entries({
      surface: ['faq', 'app'], module: ['robots', 'users', 'channels', 'billing', 'campaigns', 'templates', 'conversations', 'settings'],
      screen: ['list', 'create', 'edit', 'detail', 'connection', 'qr', 'unknown'], role: ['owner', 'admin', 'manager', 'agent', 'unknown'],
      plan: ['trial', 'active', 'expired', 'limited', 'unknown'], credit: ['available', 'low', 'empty', 'unknown'],
      templates: ['none', 'pending', 'approved', 'rejected', 'unknown'],
    })) if (allowed.includes(state[key] as string)) safeState[key] = state[key];
    if (Array.isArray(state.permissions)) safeState.permissions = state.permissions.filter((item): item is string => typeof item === 'string' && ['robots.read', 'robots.create', 'users.read', 'users.manage', 'channels.read', 'channels.manage', 'billing.read', 'campaigns.read', 'campaigns.create', 'templates.read', 'templates.manage'].includes(item)).slice(0, 12);
    if (Array.isArray(state.channels)) safeState.channels = state.channels.slice(0, 5).flatMap((item) => item && typeof item === 'object' && ['whatsapp', 'official_api', 'coexistence'].includes(item.kind) && ['connected', 'disconnected', 'qr_pending', 'blocked', 'syncing', 'unknown'].includes(item.state) ? [{ kind: item.kind, state: item.state }] : []);
    if (Array.isArray(state.incidents)) safeState.incidents = state.incidents.filter((item): item is string => typeof item === 'string' && ['channel_outage', 'message_delivery', 'billing', 'robot', 'app'].includes(item)).slice(0, 5);
  }
  return {
    intent: raw.intent as AssistantEscalation['intent'], diagnosis: raw.diagnosis as AssistantEscalation['diagnosis'],
    ...(Object.keys(safeState).length ? { state: safeState } : {}),
    attempts: Array.isArray(raw.attempts) ? raw.attempts.filter((item): item is AssistantEscalation['attempts'][number] => escalationAttempts.includes(item)).slice(0, 2) : [],
  };
}

/** Aceita o formato completo e o antigo ({ answer, sources: { title, path }[] }). */
export function normalizeReply(data: unknown): AssistantReply {
  const raw = (data ?? {}) as Record<string, unknown>;
  const answer = typeof raw.answer === 'string' ? raw.answer.trim() : '';
  if (!answer) throw new AssistantError('Resposta vazia do assistente.');
  const code = raw.code as { language?: unknown; content?: unknown } | null | undefined;
  const sources = Array.isArray(raw.sources) ? raw.sources : [];
  const resolution = raw.resolution === 'partial' || raw.resolution === 'not_found' || raw.resolution === 'complete'
    ? raw.resolution
    : raw.found === false ? 'not_found' : 'complete';
  const escalation = safeEscalation(raw.escalation);
  return {
    answer,
    sections: Array.isArray(raw.sections)
      ? raw.sections
          .filter((item): item is { title: string; items: unknown } => Boolean(item) && typeof (item as { title?: unknown }).title === 'string')
          .slice(0, 4)
          .map((item) => ({ title: item.title.trim(), items: strings(item.items, 5) }))
          .filter((item) => item.title && item.items.length)
      : [],
    steps: steps(raw.steps),
    code: code && typeof code.content === 'string' && code.content.trim()
      ? { language: typeof code.language === 'string' && code.language ? code.language : 'código', content: code.content.trim() }
      : null,
    sources: sources
      .filter((item): item is { title: string; path: string; kind?: string; excerpt?: string; media?: unknown } =>
        Boolean(item) && typeof (item as { title?: unknown }).title === 'string' && typeof (item as { path?: unknown }).path === 'string' && /^\/(?!\/)[a-z0-9/_-]+$/i.test((item as { path?: string }).path ?? ''))
      .slice(0, 4)
      .map((item) => ({ title: item.title, path: item.path, kind: kindOf(item.path), excerpt: typeof item.excerpt === 'string' ? item.excerpt : undefined, media: safeMedia(item.media) })),
    suggestions: strings(raw.suggestions, 5),
    resolution,
    found: resolution !== 'not_found' && raw.found !== false,
    ...(escalation ? { escalation } : {}),
  };
}

function waitForRetry(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, seconds * 1000);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function requestAnswer(request: AssistantRequest, signal?: AbortSignal, onRetry?: () => void): Promise<AssistantReply> {
  if (!assistantEnabled) throw new AssistantError('Assistente não configurado.', 503);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(assistantEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return normalizeReply(data);
    if (response.status === 429) {
      if (attempt === 0) {
        const parsed = Number(response.headers.get('Retry-After'));
        onRetry?.();
        await waitForRetry(Number.isFinite(parsed) ? Math.max(1, Math.min(60, parsed)) : 1, signal);
        continue;
      }
      throw new AssistantError('Só um instante. Ainda estou aguardando para responder; tente de novo em breve.', 429);
    }
    throw new AssistantError((data as { error?: string }).error ?? 'Não foi possível consultar o assistente.', response.status);
  }
  throw new AssistantError('Tive um problema. Tente de novo.', 502);
}
