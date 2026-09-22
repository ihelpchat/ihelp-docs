'use client';
import SearchDialog from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { type ReactNode } from 'react';

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{ enabled: false }}
      search={{
        SearchDialog,
        links: [
          ['Central de ajuda', '/docs'],
          ['Tutoriais', '/tutoriais'],
          ['Referência da API', '/api'],
        ],
      }}
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
