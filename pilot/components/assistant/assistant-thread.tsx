'use client';

import Link from 'next/link';
import { AlertCircle, ArrowRight, Check, ChevronRight, Copy, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { useAssistant, type ChatMessage } from '@/components/assistant/assistant-context';
import { setPendingQuery } from '@/lib/search-query';
import type { AssistantReply } from '@/lib/assistant';

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1600);
    } catch {}
  };
  return { copied, copy };
}

function plainText(reply: AssistantReply) {
  return [reply.answer, ...reply.steps.map((step, index) => `${index + 1}. ${step}`), reply.code?.content ?? ''].filter(Boolean).join('\n\n');
}

function Avatar() {
  return <span className="ih-ai-avatar" aria-hidden="true"><Sparkles /></span>;
}

function AiMessage({ message, last, compact }: { message: Extract<ChatMessage, { role: 'ai' }>; last: boolean; compact: boolean }) {
  const { feedback, rate, ask, busy, closeDrawer } = useAssistant();
  const { copied, copy } = useCopy();
  const { reply } = message;
  const rating = feedback[message.id];
  const paragraphs = reply.answer.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean);

  return (
    <div className="ih-ai-row">
      {compact ? null : <Avatar />}
      <div className="ih-ai-body">
        {compact ? null : <p className="ih-ai-name">Assistente iHelp</p>}
        {reply.found ? null : <p className="ih-ai-flag">Não encontrei isso na documentação</p>}
        <div className="ih-ai-text">
          {paragraphs.map((text, index) => <p key={index}>{text}</p>)}
        </div>
        {reply.sections.length ? (
          <div className="ih-ai-sections">
            {reply.sections.map((section) => (
              <section key={section.title}>
                <h3>{section.title}</h3>
                <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ))}
          </div>
        ) : null}
        {reply.steps.length ? (
          <ol className="ih-ai-steps">
            {reply.steps.map((step, index) => <li key={index}><span aria-hidden="true">{index + 1}</span>{step}</li>)}
          </ol>
        ) : null}
        {reply.code ? (
          <div className="ih-ai-code">
            <div className="ih-ai-code-head">
              <span>{reply.code.language}</span>
              <button type="button" onClick={() => copy('code', reply.code!.content)}>
                {copied === 'code' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied === 'code' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre><code>{reply.code.content}</code></pre>
          </div>
        ) : null}
        {reply.sources.length ? (
          <div className="ih-ai-sources">
            {compact ? null : <p className="ih-eyebrow">Fontes</p>}
            <ul>
              {reply.sources.map((source) => (
                <li key={source.path}>
                  <Link href={source.path} onClick={compact ? closeDrawer : undefined}>
                    <span className="ih-pill" data-kind={source.kind}>{source.kind}</span>
                    <span className="ih-ai-source-title">{source.title}</span>
                    {compact ? <ChevronRight aria-hidden="true" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="ih-ai-actions">
          <button type="button" onClick={() => copy('msg', plainText(reply))}>
            {compact ? null : copied === 'msg' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied === 'msg' ? 'Copiado' : 'Copiar'}
          </button>
          <button type="button" className="ih-ai-rate" aria-label="Resposta útil" aria-pressed={rating === 'up'} data-rating="up" onClick={() => rate(message.id, 'up')}>
            <ThumbsUp aria-hidden="true" />
          </button>
          <button type="button" className="ih-ai-rate" aria-label="Resposta não ajudou" aria-pressed={rating === 'down'} data-rating="down" onClick={() => rate(message.id, 'down')}>
            <ThumbsDown aria-hidden="true" />
          </button>
          {rating && !compact ? <span className="ih-ai-thanks" role="status">Obrigado pelo retorno</span> : null}
        </div>
        {last && !busy && reply.suggestions.length ? (
          <div className="ih-ai-follow">
            {reply.suggestions.map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => ask(suggestion)}>
                {compact ? null : <ArrowRight aria-hidden="true" />}
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OfflineMessage({ question, compact }: { question: string; compact: boolean }) {
  const { setOpenSearch } = useSearchContext();
  const { closeDrawer } = useAssistant();
  return (
    <div className="ih-ai-row">
      {compact ? null : <Avatar />}
      <div className="ih-ai-body">
        {compact ? null : <p className="ih-ai-name">Assistente iHelp</p>}
        <p className="ih-ai-flag">Assistente não conectado</p>
        <div className="ih-ai-text">
          <p>O assistente de IA ainda não está conectado neste ambiente, então não há resposta gerada. A busca da documentação encontra artigos, endpoints e tutoriais sobre a sua pergunta.</p>
        </div>
        <div className="ih-ai-follow">
          <button
            type="button"
            onClick={() => {
              setPendingQuery(question);
              closeDrawer();
              setOpenSearch(true);
            }}
          >
            <ArrowRight aria-hidden="true" />
            Buscar “{question.length > 48 ? `${question.slice(0, 48)}…` : question}” na documentação
          </button>
        </div>
      </div>
    </div>
  );
}

export function AssistantBusy({ compact }: { compact: boolean }) {
  const { counts, scope } = useAssistant();
  const label = `Consultando ${counts[scope]} documentos${scope === 'Tudo' ? ' da base' : ` em ${scope}`}…`;
  return (
    <div className="ih-ai-row ih-ai-busy" role="status">
      {compact ? null : <Avatar />}
      <div className="ih-ai-body">
        <p className="ih-ai-busy-label"><span className="ih-ai-dots" aria-hidden="true"><span /><span /><span /></span>{label}</p>
        <div className="ih-ai-skeleton" aria-hidden="true"><span /><span />{compact ? null : <span />}</div>
      </div>
    </div>
  );
}

export function AssistantThread({ compact = false }: { compact?: boolean }) {
  const { messages, busy, retry } = useAssistant();
  const lastAi = [...messages].reverse().find((message) => message.role === 'ai')?.id;

  return (
    <div className="ih-ai-thread" aria-live="polite" data-compact={compact || undefined}>
      {messages.map((message) => {
        if (message.role === 'user') {
          return <div key={message.id} className="ih-ai-user"><p>{message.text}</p></div>;
        }
        if (message.role === 'ai') {
          return <AiMessage key={message.id} message={message} last={message.id === lastAi && messages.at(-1)?.id === message.id} compact={compact} />;
        }
        if (message.role === 'offline') {
          return <OfflineMessage key={message.id} question={message.question} compact={compact} />;
        }
        return (
          <div key={message.id} className="ih-ai-error" role="alert">
            {compact ? null : <AlertCircle aria-hidden="true" />}
            <span>{compact ? 'Não consegui responder agora.' : 'Não consegui responder agora. Tente de novo em alguns segundos.'}</span>
            <button type="button" onClick={() => retry(message.id)}>Tentar de novo</button>
          </div>
        );
      })}
      {busy ? <AssistantBusy compact={compact} /> : null}
    </div>
  );
}
