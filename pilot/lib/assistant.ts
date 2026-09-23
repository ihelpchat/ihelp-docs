/**
 * Cliente do assistente de IA.
 *
 * O site é exportado como estático, então a IA roda fora dele: qualquer serviço que implemente o
 * contrato abaixo em `NEXT_PUBLIC_ASSISTANT_URL` funciona (hoje, `mcp/http.mjs` → `/assistant`, com GPT).
 * Sem a variável, a interface mostra o estado “não conectado” e nunca inventa resposta.
 *
 * Pedido  (POST JSON): { question, history?: {role, content}[], scope?, page?: { path, title } }
 * Resposta (JSON):     { answer, steps?, code?: { language, content } | null,
 *                        sources?: { title, path, kind?, excerpt? }[], suggestions?, found? }
 */

export const assistantEndpoint = process.env.NEXT_PUBLIC_ASSISTANT_URL?.trim() ?? '';
export const assistantEnabled = assistantEndpoint.length > 0;

export const assistantScopes = ['Tudo', 'Ajuda e FAQ', 'API', 'Tutoriais', 'Novidades'] as const;
export type AssistantScope = (typeof assistantScopes)[number];

export type SourceKind = 'Ajuda' | 'FAQ' | 'API' | 'Tutorial' | 'Novidade';

export type AssistantSource = { title: string; path: string; kind: SourceKind; excerpt?: string };
export type AssistantSection = { title: string; items: string[] };

export type AssistantReply = {
  answer: string;
  sections: AssistantSection[];
  steps: string[];
  code: { language: string; content: string } | null;
  sources: AssistantSource[];
  suggestions: string[];
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

/** Aceita o formato completo e o antigo ({ answer, sources: { title, path }[] }). */
export function normalizeReply(data: unknown): AssistantReply {
  const raw = (data ?? {}) as Record<string, unknown>;
  const answer = typeof raw.answer === 'string' ? raw.answer.trim() : '';
  if (!answer) throw new AssistantError('Resposta vazia do assistente.');
  const code = raw.code as { language?: unknown; content?: unknown } | null | undefined;
  const sources = Array.isArray(raw.sources) ? raw.sources : [];
  return {
    answer,
    sections: Array.isArray(raw.sections)
      ? raw.sections
          .filter((item): item is { title: string; items: unknown } => Boolean(item) && typeof (item as { title?: unknown }).title === 'string')
          .slice(0, 4)
          .map((item) => ({ title: item.title.trim(), items: strings(item.items, 5) }))
          .filter((item) => item.title && item.items.length)
      : [],
    steps: strings(raw.steps, 12),
    code: code && typeof code.content === 'string' && code.content.trim()
      ? { language: typeof code.language === 'string' && code.language ? code.language : 'código', content: code.content.trim() }
      : null,
    sources: sources
      .filter((item): item is { title: string; path: string; kind?: string; excerpt?: string } =>
        Boolean(item) && typeof (item as { title?: unknown }).title === 'string' && typeof (item as { path?: unknown }).path === 'string' && (item as { path: string }).path.startsWith('/'))
      .slice(0, 4)
      .map((item) => ({ title: item.title, path: item.path, kind: kindOf(item.path), excerpt: typeof item.excerpt === 'string' ? item.excerpt : undefined })),
    suggestions: strings(raw.suggestions, 3),
    found: raw.found !== false,
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
