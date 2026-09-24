import allowedActions from '@/architecture/product-actions.json';

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
export type AssistantStep = { text: string; action?: AssistantProductAction };
export type AssistantResolution = 'complete' | 'partial' | 'not_found';

export type AssistantReply = {
  answer: string;
  sections: AssistantSection[];
  steps: AssistantStep[];
  code: { language: string; content: string } | null;
  sources: AssistantSource[];
  suggestions: string[];
  resolution: AssistantResolution;
  found: boolean;
};

export type AssistantHistoryItem = { role: 'user' | 'assistant'; content: string };

export type AssistantRequest = {
  question: string;
  history: AssistantHistoryItem[];
  scope: AssistantScope;
  page?: { path: string; title: string };
};

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
  if (!value || typeof value !== 'object') return undefined;
  const action = value as Record<string, unknown>;
  if (typeof action.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(action.id)) return undefined;
  if (typeof action.label !== 'string' || action.label.length < 3 || action.label.length > 80) return undefined;
  if (typeof action.route !== 'string' || !/^\/(?!\/)[a-z0-9/_-]*$/.test(action.route)) return undefined;
  const target = typeof action.target === 'string' && /^[a-z][a-z0-9-]{2,63}$/.test(action.target) ? action.target : undefined;
  const allowed = (allowedActions as Record<string, { route: string; target: string }>)[action.id];
  if (!allowed || action.route !== allowed.route || target !== allowed.target) return undefined;
  return { id: action.id, label: action.label, route: action.route, ...(target ? { target } : {}) };
}

function steps(value: unknown): AssistantStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [{ text: item.trim() }];
    if (!item || typeof item !== 'object' || typeof (item as { text?: unknown }).text !== 'string') return [];
    const raw = item as { text: string; action?: unknown };
    const text = raw.text.trim();
    if (!text) return [];
    const action = safeAction(raw.action);
    return [{ text, ...(action ? { action } : {}) }];
  });
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
    suggestions: strings(raw.suggestions, 3),
    resolution,
    found: resolution !== 'not_found' && raw.found !== false,
  };
}

export async function requestAnswer(request: AssistantRequest, signal?: AbortSignal): Promise<AssistantReply> {
  if (!assistantEnabled) throw new AssistantError('Assistente não configurado.', 503);
  const response = await fetch(assistantEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AssistantError((data as { error?: string }).error ?? 'Não foi possível consultar o assistente.', response.status);
  return normalizeReply(data);
}
