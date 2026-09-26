'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ArrowRight, Maximize2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { useAssistant } from '@/components/assistant/assistant-context';
import { AssistantComposer } from '@/components/assistant/assistant-composer';
import { AssistantThread } from '@/components/assistant/assistant-thread';
import { TechnologyMark } from '@/components/site/technology-mark';
import { assistantDisplayName } from '@/lib/assistant-name';
import { supportLink, supportGuideFromPage, supportGuideFromReply } from '@/lib/links';
import { supportMessageFor } from '@/lib/assistant';

const sectionLabel: Record<string, string> = {
  docs: 'Central de ajuda',
  api: 'Referência da API',
  tutoriais: 'Tutoriais guiados',
  blog: 'Novidades',
};

/** Perguntas de partida por área. São só perguntas: a resposta vem sempre da documentação. */
const startersBySection: Record<string, string[]> = {
  docs: ['Resuma esta página em 3 pontos', 'Quais são os passos principais desta página?', 'O que devo conferir antes de começar?'],
  api: ['Resuma esta página da API', 'Mostre um exemplo desta chamada em Node', 'Quais campos da resposta são mais importantes?'],
  tutoriais: ['Qual guia devo seguir primeiro?', 'Como transfiro um atendimento, passo a passo?', 'Tem guia sobre o CRM?'],
  blog: ['O que mudou recentemente no iHelp?', 'Resuma a novidade mais recente', 'Quais novidades envolvem atendimento?'],
  home: [
    'Meu WhatsApp desconectou. Como reconecto sem perder o histórico?',
    'Como criar, trocar ou desativar um usuário?',
    'Como configurar o robô e testar antes de publicar?',
    'Qual a diferença entre API Oficial e QR Code?',
  ],
};

export function usePageRef() {
  const pathname = usePathname();
  const [title, setTitle] = useState('');
  useEffect(() => {
    // O título da aba já tem o nome da página (“Atendimento | iHelp”).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(document.title.replace(/\s*\|\s*iHelp\s*$/, '').trim());
  }, [pathname]);
  const section = pathname.split('/').filter(Boolean)[0] ?? 'home';
  const root = sectionLabel[section];
  const label = !root ? 'Início' : pathname.replace(/\/$/, '') === `/${section}` ? root : `${root} › ${title || '…'}`;
  return { path: pathname.replace(/\/$/, '') || '/', title, label, section: root ? section : 'home' };
}

export function AssistantLauncher() {
  const { drawerOpen, openDrawer, messages } = useAssistant();
  const { open: searchOpen } = useSearchContext();
  const pathname = usePathname();
  if (drawerOpen || searchOpen || pathname.startsWith('/assistente')) return null;
  return (
    <button type="button" className="ih-ai-launcher" onClick={openDrawer} aria-haspopup="dialog">
      <Sparkles aria-hidden="true" />
      {assistantDisplayName}
      {messages.length ? <span className="ih-ai-launcher-dot" aria-label="conversa em andamento" /> : null}
    </button>
  );
}

export function AssistantDrawer() {
  const { drawerOpen, closeDrawer, messages, busy, newChat, ask } = useAssistant();
  const router = useRouter();
  const pathname = usePathname();
  const page = usePageRef();
  const panel = useRef<HTMLDivElement>(null);
  const open = drawerOpen && !pathname.startsWith('/assistente');
  const latestReply = [...messages].reverse().find((message) => message.role === 'ai')?.reply;
  const guide = supportGuideFromPage() ?? supportGuideFromReply(latestReply);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDrawer]);

  useEffect(() => {
    const node = panel.current?.querySelector('.ih-ai-drawer-thread');
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [messages.length, busy, open]);

  if (!open) return null;
  const ref = page.section === 'home' ? undefined : { path: page.path, title: page.title };

  return (
    <div className="ih-ai-drawer" role="dialog" aria-label={assistantDisplayName} ref={panel}>
      <header className="ih-ai-drawer-head">
        <span className="ih-ai-avatar" aria-hidden="true"><Sparkles /></span>
        <div>
          <p className="ih-ai-drawer-title">{assistantDisplayName}</p>
          <p className="ih-ai-drawer-sub">Responde com base na documentação do iHelp</p>
        </div>
        <button
          type="button"
          aria-label="Abrir em tela cheia"
          title="Abrir em tela cheia"
          onClick={() => {
            closeDrawer();
            const query = guide ? `?guideId=${encodeURIComponent(guide.guideId)}&stepId=${encodeURIComponent(guide.stepId)}` : '';
            router.push(`/assistente${query}`);
          }}
        >
          <Maximize2 aria-hidden="true" />
        </button>
        <button type="button" aria-label="Fechar assistente" title="Fechar" onClick={closeDrawer}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="ih-ai-drawer-context">
        <span>Você está em</span>
        <strong>{page.label}</strong>
        {messages.length ? <button type="button" onClick={newChat}>Nova conversa</button> : null}
      </div>
      <div className="ih-ai-drawer-thread">
        {messages.length === 0 && !busy ? (
          <div className="ih-ai-drawer-empty">
            <p className="ih-ai-drawer-empty-title">Como posso ajudar?</p>
            <p>Pergunte sem sair da página. Se precisar, abra em tela cheia — a conversa vai junto.</p>
            <ul>
              {(startersBySection[page.section] ?? startersBySection.home).map((starter) => (
                <li key={starter}>
                  <button type="button" onClick={() => ask(starter, { page: ref })}>
                    <ArrowRight aria-hidden="true" />
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <AssistantThread compact />
        )}
      </div>
      <div className="ih-ai-drawer-foot">
        <a className="ih-ai-drawer-human" href={supportLink({ guide, message: latestReply ? supportMessageFor(latestReply) : undefined })} target="_blank" rel="noreferrer noopener">Falar com uma pessoa</a>
        <AssistantComposer compact autoFocus placeholder="Pergunte sobre esta página ou qualquer outra coisa" page={ref} />
        <div className="ih-ai-drawer-meta">
          <p>Gerado por IA a partir da documentação. Confira as fontes.</p>
          <TechnologyMark compact />
        </div>
      </div>
    </div>
  );
}
