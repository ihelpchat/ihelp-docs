'use client';

import { SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAssistant } from '@/components/assistant/assistant-context';

type ComposerProps = {
  compact?: boolean;
  placeholder: string;
  autoFocus?: boolean;
  page?: { path: string; title: string };
};

/** Campo de pergunta: Enter envia, Shift+Enter quebra linha, cresce até um limite. */
export function AssistantComposer({ compact = false, placeholder, autoFocus = false, page }: ComposerProps) {
  const { ask, busy } = useAssistant();
  const [draft, setDraft] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const max = compact ? 120 : 160;
  const canSend = draft.trim().length > 0 && !busy;

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const resize = () => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(max, element.scrollHeight)}px`;
  };

  const send = () => {
    if (!canSend) return;
    ask(draft, { page });
    setDraft('');
    requestAnimationFrame(resize);
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="ih-ai-composer" data-compact={compact || undefined}>
      <textarea
        ref={field}
        rows={1}
        value={draft}
        placeholder={placeholder}
        aria-label="Pergunta para o assistente"
        onChange={(event) => {
          setDraft(event.target.value);
          resize();
        }}
        onKeyDown={onKey}
        maxLength={500}
      />
      <button type="button" className="ih-ai-send" onClick={send} disabled={!canSend} aria-label="Enviar pergunta">
        <SendHorizontal aria-hidden="true" />
      </button>
    </div>
  );
}
