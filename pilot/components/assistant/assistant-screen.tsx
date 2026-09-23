'use client';

import Link from 'next/link';
import { ExternalLink, Plus, Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useAssistant, type ChatMessage } from '@/components/assistant/assistant-context';
import { AssistantComposer } from '@/components/assistant/assistant-composer';
import { AssistantThread } from '@/components/assistant/assistant-thread';
import { assistantScopes, type SourceKind } from '@/lib/assistant';
import { supportUrl } from '@/lib/links';
import { TechnologyMark } from '@/components/site/technology-mark';

const starters: { kind: SourceKind; label: string }[] = [
  { kind: 'Ajuda', label: 'Meu WhatsApp desconectou. Como reconecto sem perder o histórico?' },
  { kind: 'Ajuda', label: 'Como criar, trocar ou desativar um usuário?' },
  { kind: 'Tutorial', label: 'Como configurar o robô e testar antes de publicar?' },
  { kind: 'FAQ', label: 'Qual a diferença entre API Oficial e QR Code?' },
];

/** Texto da conversa para mandar ao suporte pelo WhatsApp (limitado ao tamanho que o link aceita). */
function transcript(messages: ChatMessage[]) {
  const lines = messages.flatMap((message) => {
    if (message.role === 'user') return [`Eu: ${message.text}`];
    if (message.role === 'ai') return [`Assistente: ${message.reply.answer}`];
    return [];
  });
  const text = ['Olá! Conversei com o assistente da documentação e ainda preciso de ajuda.', '', ...lines].join('\n');
  return text.length > 1800 ? `${text.slice(0, 1800)}…` : text;
}

function SourcesPanel() {
  const { messages } = useAssistant();
  const last = [...messages].reverse().find((message): message is Extract<ChatMessage, { role: 'ai' }> => message.role === 'ai');
  const sources = last?.reply.sources ?? [];
  const hasChat = messages.some((message) => message.role === 'user');

  return (
    <aside className="ih-ai-panel" aria-label="Fontes da resposta">
      <p className="ih-eyebrow">Fontes da resposta</p>
      <p className="ih-ai-panel-sub">
        {last ? `${sources.length} ${sources.length === 1 ? 'documento usado' : 'documentos usados'}` : 'Base: ajuda, FAQ, tutoriais, novidades e API'}
      </p>
      {sources.length ? (
        <ul className="ih-ai-panel-list">
          {sources.map((source) => (
            <li key={source.path}>
              <Link href={source.path}>
                <span className="ih-ai-panel-head"><span className="ih-pill" data-kind={source.kind}>{source.kind}</span><ExternalLink aria-hidden="true" /></span>
                <strong>{source.title}</strong>
                {source.excerpt ? <span>{source.excerpt.length > 150 ? `${source.excerpt.slice(0, 150).trim()}…` : source.excerpt}</span> : null}
                <small>Abrir artigo</small>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ih-ai-panel-empty">Quando o assistente responder, os artigos, tutoriais e endpoints usados aparecem aqui para você conferir.</p>
      )}
      <div className="ih-ai-panel-support">
        <strong>A resposta não resolveu?</strong>
        <p>{hasChat ? 'A conversa vai pronta na mensagem para o suporte, sem você repetir nada.' : 'Fale com o suporte pelo WhatsApp.'}</p>
        <a className="ih-button" href={`${supportUrl}?text=${encodeURIComponent(transcript(messages))}`} target="_blank" rel="noreferrer noopener">
          Enviar para o suporte
        </a>
      </div>
    </aside>
  );
}

export function AssistantScreen() {
  const { messages, busy, ask, scope, setScope, newChat } = useAssistant();
  const scroller = useRef<HTMLDivElement>(null);
  const empty = messages.length === 0 && !busy;

  useEffect(() => {
    const node = scroller.current;
    // Só acompanha o fim da conversa quando há conversa; a tela vazia fica no topo.
    if (node && (messages.length || busy)) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy]);

  return (
    <div className="ih-ai-screen">
      <div className="ih-ai-main">
        <div className="ih-ai-scroll" ref={scroller}>
          <div className="ih-ai-column">
            {empty ? (
              <section className="ih-ai-empty">
                <span className="ih-ai-empty-icon" aria-hidden="true"><Sparkles /></span>
                <h1>Pergunte qualquer coisa sobre o iHelp</h1>
                <p>O assistente responde com base na Central de ajuda, nas principais dúvidas, nos tutoriais, nas novidades e na referência da API — e mostra de onde tirou cada resposta.</p>
                <div className="ih-ai-starters">
                  {starters.map((starter) => (
                    <button type="button" key={starter.label} onClick={() => ask(starter.label)}>
                      <span className="ih-pill" data-kind={starter.kind}>{starter.kind}</span>
                      <span>{starter.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <>
                <h1 className="ih-visually-hidden">Assistente de IA</h1>
                <AssistantThread />
              </>
            )}
          </div>
        </div>
        <div className="ih-ai-footer">
          <div className="ih-ai-column">
            <div className="ih-ai-scopes">
              <span id="ih-ai-scope-label">Buscar em</span>
              <div role="group" aria-labelledby="ih-ai-scope-label">
                {assistantScopes.map((item) => (
                  <button type="button" key={item} className="ih-chip" aria-pressed={scope === item} onClick={() => setScope(item)}>{item}</button>
                ))}
              </div>
              {messages.length ? (
                <button type="button" className="ih-ai-new" onClick={newChat}><Plus aria-hidden="true" />Nova conversa</button>
              ) : null}
            </div>
            <AssistantComposer placeholder="Pergunte sobre atendimento, campanhas, API, tutoriais…" autoFocus />
            <div className="ih-ai-hint">
              <span>Respostas geradas por IA a partir da documentação. Confira as fontes antes de agir.</span>
              <span className="ih-ai-hint-meta">
                <span><kbd>↵</kbd> enviar · <kbd>shift ↵</kbd> nova linha</span>
                <TechnologyMark compact />
              </span>
            </div>
          </div>
        </div>
      </div>
      <SourcesPanel />
    </div>
  );
}
