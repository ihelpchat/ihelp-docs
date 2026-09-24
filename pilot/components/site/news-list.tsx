'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { NewsEntry } from '@/lib/news';

export function NewsList({ entries }: { entries: NewsEntry[] }) {
  const [filter, setFilter] = useState('Tudo');
  const filters = ['Tudo', ...new Set(entries.map((entry) => entry.tag))];
  const visible = entries.filter((entry) => filter === 'Tudo' || entry.tag === filter);

  return (
    <>
      <div className="ih-chips" role="group" aria-label="Filtrar novidades">
        {filters.map((name) => (
          <button key={name} type="button" className="ih-chip" aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>
        ))}
      </div>
      <ol className="ih-timeline">
        {visible.map((entry) => (
          <li key={entry.url}>
            <time dateTime={entry.date}>{entry.dateLabel}</time>
            <div className="ih-timeline-body">
              <p className="ih-timeline-meta"><span className="ih-pill" data-kind={entry.tag}>{entry.tag}</span><span>{entry.author}</span></p>
              <h2><Link href={entry.url}>{entry.title}</Link></h2>
              <p>{entry.description}</p>
              <Link className="ih-link-arrow" href={entry.url}>Ler novidade<ChevronRight aria-hidden="true" /></Link>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
