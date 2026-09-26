'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  assistantEnabled,
  AssistantError,
  requestAnswer,
  type AssistantHistoryItem,
  type AssistantReply,
  type AssistantScope,
} from '@/lib/assistant';
import { submitFeedback } from '@/lib/feedback';

export type ScopeCounts = Record<AssistantScope, number>;

export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'ai'; reply: AssistantReply; question: string }
  | { id: string; role: 'error'; question: string; message: string; status?: number }
  | { id: string; role: 'offline'; question: string };

type PageRef = { path: string; title: string };

type AssistantState = {
  messages: ChatMessage[];
  busy: boolean;
  retrying: boolean;
  scope: AssistantScope;
  drawerOpen: boolean;
  feedback: Record<string, 'up' | 'down'>;
  counts: ScopeCounts;
  enabled: boolean;
  ask: (question: string, options?: { page?: PageRef }) => void;
  retry: (id: string) => void;
  newChat: () => void;
  setScope: (scope: AssistantScope) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  rate: (id: string, value: 'up' | 'down') => void;
};

const Context = createContext<AssistantState | null>(null);
const storageKey = 'ih-assistant-v1';

function id(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function historyOf(messages: ChatMessage[]): AssistantHistoryItem[] {
  const history: AssistantHistoryItem[] = [];
  for (const message of messages) {
    if (message.role === 'user') history.push({ role: 'user', content: message.text });
    else if (message.role === 'ai') {
      const sections = message.reply.sections.flatMap((section) => [section.title, ...section.items.map((item) => `- ${item}`)]);
      const steps = message.reply.steps.map((step, index) => `${index + 1}. ${step.text}`);
      const sources = message.reply.sources.map((source) => `Fonte usada: ${source.path}`);
      history.push({
        role: 'assistant',
        content: [message.reply.answer, ...sections, ...steps, ...sources].filter(Boolean).join('\n'),
      });
    }
  }
  return history.slice(-6);
}

export function AssistantProvider({ counts, children }: { counts: ScopeCounts; children: ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [scope, setScope] = useState<AssistantScope>('Tudo');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const sessionId = useRef(id('session-'));
  const abort = useRef<AbortController | null>(null);
  // Lido pelas ações (que não mudam de identidade) para ver sempre o estado mais recente.
  const state = useRef({ messages, busy, scope });
  useLayoutEffect(() => {
    state.current = { messages, busy, scope };
  }, [messages, busy, scope]);

  // A conversa sobrevive à navegação e ao recarregar a aba (fica só neste navegador).
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as { messages?: ChatMessage[]; scope?: AssistantScope; sessionId?: string } | null;
      if (saved?.messages?.length) setMessages(saved.messages);
      if (saved?.scope) setScope(saved.scope);
      if (saved?.sessionId && /^[a-zA-Z0-9_-]{8,128}$/.test(saved.sessionId)) sessionId.current = saved.sessionId;
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ messages: messages.slice(-40), scope, sessionId: sessionId.current }));
    } catch {}
  }, [messages, scope]);

  const run = useCallback(async (question: string, page?: PageRef, prior?: ChatMessage[]) => {
    const base = prior ?? state.current.messages;
    const history = historyOf(base);
    setMessages([...base, { id: id('u'), role: 'user', text: question }]);
    if (!assistantEnabled) {
      setMessages((list) => [...list, { id: id('o'), role: 'offline', question }]);
      return;
    }
    setBusy(true);
    setRetrying(false);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const reply = await requestAnswer({ question, history, scope: state.current.scope, page, sessionId: sessionId.current, origin: 'faq' }, controller.signal, () => setRetrying(true));
      setMessages((list) => [...list, { id: id('a'), role: 'ai', reply, question }]);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : '';
      setMessages((list) => [...list, { id: id('e'), role: 'error', question, message, status: error instanceof AssistantError ? error.status : undefined }]);
    } finally {
      if (abort.current === controller) {
        setBusy(false);
        setRetrying(false);
      }
    }
  }, []);

  const ask = useCallback((raw: string, options?: { page?: PageRef }) => {
    const question = raw.trim();
    if (!question || state.current.busy) return;
    void run(question, options?.page);
  }, [run]);

  const retry = useCallback((messageId: string) => {
    const list = state.current.messages;
    const index = list.findIndex((message) => message.id === messageId);
    const failed = list[index];
    if (!failed || failed.role !== 'error' || state.current.busy) return;
    // Remove a pergunta e o erro, e pergunta de novo.
    void run(failed.question, undefined, list.slice(0, Math.max(0, index - 1)));
  }, [run]);

  const value = useMemo<AssistantState>(() => ({
    messages,
    busy,
    retrying,
    scope,
    drawerOpen,
    feedback,
    counts,
    enabled: assistantEnabled,
    ask,
    retry,
    newChat: () => {
      abort.current?.abort();
      sessionId.current = id('session-');
      setBusy(false);
      setMessages([]);
      setFeedback({});
    },
    setScope,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    rate: (messageId, rating) => {
      const message = state.current.messages.find((item) => item.id === messageId);
      if (!message || message.role !== 'ai') return;
      setFeedback((current) => ({ ...current, [messageId]: rating }));
      void submitFeedback({
        eventId: message.id,
        type: 'assistant',
        value: rating,
        path: window.location.pathname,
        sources: message.reply.sources.map((source) => source.path),
      });
    },
  }), [messages, busy, retrying, scope, drawerOpen, feedback, counts, ask, retry]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAssistant() {
  const value = useContext(Context);
  if (!value) throw new Error('useAssistant fora do AssistantProvider');
  return value;
}
