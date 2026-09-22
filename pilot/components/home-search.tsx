'use client';

import { ArrowRight, Sparkles } from 'lucide-react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { setPendingQuery } from '@/lib/search-query';

const suggestions = [
  'Como transferir um atendimento?',
  'Onde pego meu token da API?',
  'Quanto custa a API oficial do WhatsApp?',
  'Como importar contatos por CSV?',
];

export function HomeSearch() {
  const { setOpenSearch } = useSearchContext();
  const ask = (query: string) => {
    setPendingQuery(query);
    setOpenSearch(true);
  };

  return (
    <div className="home-search-block">
      <button type="button" className="home-search" onClick={() => ask('')}>
        <Sparkles aria-hidden="true" />
        <span>Como faço para transferir um atendimento?</span>
        <span className="home-search-action">
          Perguntar <ArrowRight aria-hidden="true" />
        </span>
      </button>
      <div className="search-suggestions" aria-label="Sugestões de busca">
        {suggestions.map((suggestion) => (
          <button type="button" key={suggestion} onClick={() => ask(suggestion.replace(/\?$/, ''))}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AskButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const { setOpenSearch } = useSearchContext();
  return <button type="button" className={className} onClick={() => setOpenSearch(true)}>{children}</button>;
}
