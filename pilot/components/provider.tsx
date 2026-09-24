'use client';
import SearchDialog, { type SiteCounts } from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { useCallback, type ReactNode } from 'react';
import type { SharedProps } from 'fumadocs-ui/contexts/search';

export function Provider({ children, counts }: { children: ReactNode; counts: SiteCounts }) {
  const Dialog = useCallback((props: SharedProps) => <SearchDialog {...props} counts={counts} />, [counts]);
  return (
    <RootProvider
      theme={{ enabled: false }}
      search={{ SearchDialog: Dialog }}
      i18n={{
        locale: 'pt-BR',
        defaultLanguage: 'pt-BR',
        translations: {
          'Search(search dialog)': 'Buscar na documentação',
          'Search(search trigger)': 'Buscar ou perguntar',
          'No results found(search dialog)': 'Nenhum resultado encontrado',
          'Close Search(search dialog)(aria-label)': 'Fechar busca',
          'On this page(table of contents)': 'Nesta página',
          'Copy Markdown(page actions)': 'Copiar Markdown',
          'View as Markdown(page actions)': 'Ver como Markdown',
          'Edit on GitHub(edit page)': 'Editar no GitHub',
          'Next Page(pagination)': 'Próxima página',
          'Previous Page(pagination)': 'Página anterior',
        },
      }}
    >
      {children}
    </RootProvider>
  );
}
