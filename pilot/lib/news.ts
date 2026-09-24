import { source } from '@/lib/source';

const tagLabels: Record<string, string> = {
  atualizacao: 'Atualização',
  atendimento: 'Atendimento',
  mensagens: 'Mensagens',
  whatsapp: 'WhatsApp',
  seguranca: 'Segurança',
  agendamento: 'Agendamento',
};

// Autores definidos em blog/authors.yml do site legado.
const authorLabels: Record<string, string> = { gian: 'Equipe iHelp' };

export type NewsEntry = {
  url: string;
  title: string;
  description: string;
  date: string;
  dateLabel: string;
  tag: string;
  author: string;
};

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatNewsDate(date: Date) {
  return dateFormat.format(date).replace(/\./g, '').replace(/ de /g, ' ');
}

export function getNews(): NewsEntry[] {
  return source
    .getPages()
    .filter((page) => page.url.startsWith('/blog/') && page.data.date)
    .map((page) => {
      const tags = page.data.tags ?? [];
      const topic = tags.find((tag) => tag !== 'atualizacao') ?? tags[0] ?? 'atualizacao';
      return {
        url: page.url,
        title: page.data.title,
        description: page.data.description,
        date: page.data.date!.toISOString(),
        dateLabel: formatNewsDate(page.data.date!),
        tag: tagLabels[topic] ?? topic,
        author: authorLabels[page.data.authors?.[0] ?? ''] ?? 'Equipe iHelp',
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}
