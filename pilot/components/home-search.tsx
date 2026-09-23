'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { setPendingQuery } from '@/lib/search-query';
import { useAssistant } from '@/components/assistant/assistant-context';

const suggestions = [
  'Como reconectar meu WhatsApp?',
  'Como criar ou desativar um usuário?',
  'Como configurar o robô de atendimento?',
  'API Oficial ou QR Code?',
];

/**
 * Com o assistente conectado, a caixa da home leva à tela do assistente e os atalhos já perguntam.
 * Sem ele, tudo abre a busca local, sem prometer resposta de IA.
 */
function useAskOrSearch() {
  const router = useRouter();
  const { setOpenSearch } = useSearchContext();
  const { enabled, ask } = useAssistant();
  return (question: string) => {
    if (enabled) {
      router.push('/assistente');
      if (question) ask(question);
      return;
    }
    setPendingQuery(question.replace(/\?$/, ''));
    setOpenSearch(true);
  };
}

export function HomeSearch() {
  const go = useAskOrSearch();

  return (
    <div className="home-search-block">
      <button type="button" className="home-search" onClick={() => go('')}>
        <Sparkles aria-hidden="true" />
        <span>Meu WhatsApp desconectou. Como reconectar?</span>
        <span className="home-search-action">
          Perguntar <ArrowRight aria-hidden="true" />
        </span>
      </button>
      <div className="search-suggestions" aria-label="Perguntas sugeridas">
        {suggestions.map((suggestion) => (
          <button type="button" key={suggestion} onClick={() => go(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AskButton({ className, children }: { className?: string; children: ReactNode }) {
  const go = useAskOrSearch();
  return <button type="button" className={className} onClick={() => go('')}>{children}</button>;
}
