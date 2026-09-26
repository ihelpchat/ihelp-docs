'use client';

import Link from 'next/link';
import Image from 'next/image';
import { AlertCircle, ArrowRight, Check, ChevronRight, Copy, MessageCircle, Play, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { useAssistant, type ChatMessage } from '@/components/assistant/assistant-context';
import { setPendingQuery } from '@/lib/search-query';
import { supportMessageFor, type AssistantReply } from '@/lib/assistant';
import { supportUrl } from '@/lib/links';
import { productActionUrl } from '@/lib/links';

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
  const sections = reply.sections.flatMap((section) => [section.title, ...section.items.map((item) => `• ${item}`)]);
  return [reply.answer, ...sections, ...reply.steps.map((step, index) => `${index + 1}. ${step.text}`), reply.code?.content ?? ''].filter(Boolean).join('\n\n');
}

function Avatar() {
  return <span className="ih-ai-avatar" aria-hidden="true"><Sparkles /></span>;
}

function StepVisual({ image }: { image: NonNullable<AssistantReply['steps'][number]['image']> }) {
  return (
    <details className="ih-ai-step-visual">
      <summary>Ver onde clicar</summary>
      <Image className="ih-ai-step-image" src={image.src} alt={image.alt} width={960} height={540} loading="lazy" />
    </details>
  );
}

function MediaGuide({ reply, openMedia, setOpenMedia }: {
  reply: AssistantReply;
  openMedia: string | null;
  setOpenMedia: (path: string | null) => void;
}) {
  const sources = reply.sources.filter((source) => source.media);
  if (!sources.length) return null;
  return (
    <section className="ih-ai-media-guide" aria-label="Vídeos e guias deste procedimento">
      <div className="ih-ai-media-guide-copy">
        <strong>Quer ver como funciona antes de começar?</strong>
        <p>Temos {sources.length === 1 ? 'um vídeo ou guia que mostra' : 'vídeos e guias que mostram'} este processo. Você pode assistir aqui ou continuar pelo passo a passo abaixo.</p>
      </div>
      {sources.map((source) => {
        const media = source.media!;
        const expanded = openMedia === source.path;
        return (
          <div className="ih-ai-media-guide-item" key={source.path}>
            <span className="ih-pill">{media.kind === 'tango' ? 'Tango' : 'Vídeo'}</span>
            {media.embedUrl ? (
              <button type="button" onClick={() => setOpenMedia(expanded ? null : source.path)} aria-expanded={expanded}>
                <Play aria-hidden="true" />{media.kind === 'tango' ? 'Abrir guia interativo' : 'Assistir vídeo'}
              </button>
            ) : (
              <a href={media.url} target="_blank" rel="noreferrer noopener">Abrir no Tango</a>
            )}
            {expanded && media.embedUrl ? (
              <div className="ih-ai-media">
                {media.kind === 'video' && media.embedUrl.startsWith('/') ? (
                  <video controls preload="metadata" aria-label={`Vídeo: ${source.title}`}><source src={media.embedUrl} /></video>
                ) : (
                  <iframe src={media.embedUrl} title={`${media.kind === 'tango' ? 'Tango' : 'Vídeo'}: ${source.title}`} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation" allowFullScreen />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function AiMessage({ message, last, compact }: { message: Extract<ChatMessage, { role: 'ai' }>; last: boolean; compact: boolean }) {
  const { feedback, rate, ask, busy, closeDrawer } = useAssistant();
  const { copied, copy } = useCopy();
  const [openMedia, setOpenMedia] = useState<string | null>(null);
  const { reply } = message;
  const rating = feedback[message.id];
  const paragraphs = reply.answer.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean);
  const needsSupport = reply.resolution !== 'complete';
  const supportMessage = supportMessageFor(reply);

  return (
    <div className="ih-ai-row">
      {compact ? null : <Avatar />}
      <div className="ih-ai-body">
        {compact ? null : <p className="ih-ai-name">Claricia · assistente de IA do iHelp</p>}
        {reply.resolution === 'partial' ? <p className="ih-ai-flag">Parte da resposta exige atendimento</p> : null}
        {reply.resolution === 'not_found' ? <p className="ih-ai-flag">Procedimento não documentado</p> : null}
        <div className="ih-ai-text">
          {paragraphs.map((text, index) => <p key={index}>{text}</p>)}
        </div>
        <MediaGuide reply={reply} openMedia={openMedia} setOpenMedia={setOpenMedia} />
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
            {reply.steps.map((step, index) => (
              <li key={`${step.text}-${index}`}>
                <span aria-hidden="true">{index + 1}</span>
                <div>
                  <p>{step.text}</p>
                  {step.image ? <StepVisual image={step.image} /> : null}
                  {step.action && productActionUrl(step.action.route, step.action.id, step.action.target) ? (
                    <a className="ih-ai-product-action" href={productActionUrl(step.action.route, step.action.id, step.action.target) ?? undefined} target="_blank" rel="noreferrer noopener">
                      {step.action.label}<ArrowRight aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
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
                    <span className="ih-ai-source-copy">
                      <span className="ih-ai-source-title">{source.title}</span>
                      <small>Ver resposta completa</small>
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {needsSupport ? (
          <div className="ih-ai-support-cta">
            <div>
              <strong>Precisa concluir este procedimento?</strong>
              <span>Nosso time de atendimento continua com você pelo WhatsApp.</span>
            </div>
            <a href={`${supportUrl}?text=${encodeURIComponent(supportMessage)}`} target="_blank" rel="noreferrer noopener">
              <MessageCircle aria-hidden="true" />
              Falar com o atendimento
            </a>
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
            <p>Posso continuar com você:</p>
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
        {compact ? null : <p className="ih-ai-name">Claricia · assistente de IA do iHelp</p>}
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
  const { counts, scope, retrying } = useAssistant();
  const label = retrying ? 'Só um instante, já te respondo…' : `Consultando ${counts[scope]} documentos${scope === 'Tudo' ? ' da base' : ` em ${scope}`}…`;
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
            <span>{message.status === 429 ? message.message : compact ? 'Não consegui responder agora.' : 'Não consegui responder agora. Tente de novo em alguns segundos.'}</span>
            <div className="ih-ai-error-actions">
              <button type="button" onClick={() => retry(message.id)}>Tentar de novo</button>
              {message.status === 429 ? <a href={supportUrl} target="_blank" rel="noreferrer noopener">Falar com uma pessoa</a> : null}
            </div>
          </div>
        );
      })}
      {busy ? <AssistantBusy compact={compact} /> : null}
    </div>
  );
}
