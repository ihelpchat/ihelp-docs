'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

export type FaqItem = {
  id: string;
  question: string;
  category: string;
  text: string;
  answer: ReactNode;
};

export function FaqList({ items }: { items: FaqItem[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Todas');
  const [open, setOpen] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    // Abre a pergunta indicada no link (#id) depois da hidratação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hash && items.some((item) => item.id === hash)) setOpen(hash);
  }, [items]);

  const categories = useMemo(() => ['Todas', ...new Set(items.map((item) => item.category))], [items]);
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  const visible = items.filter((item) => (category === 'Todas' || item.category === category) && (!needle || item.text.includes(needle)));

  return (
    <div className="ih-faq">
      <label className="ih-faq-filter">
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar dúvidas" aria-label="Filtrar dúvidas" />
        <span>{visible.length} de {items.length}</span>
      </label>
      <div className="ih-chips" role="group" aria-label="Categorias">
        {categories.map((name) => (
          <button key={name} type="button" className="ih-chip" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>
        ))}
      </div>
      {visible.length ? (
        <div className="ih-faq-list">
          {visible.map((item) => {
            const expanded = open === item.id;
            return (
              <section key={item.id} id={item.id} className="ih-faq-item" data-open={expanded || undefined}>
                <h3>
                  <button type="button" aria-expanded={expanded} aria-controls={`${item.id}-resposta`} onClick={() => setOpen(expanded ? null : item.id)}>
                    <span className="ih-faq-cat">{item.category}</span>
                    <span className="ih-faq-q">{item.question}</span>
                    <ChevronDown aria-hidden="true" />
                  </button>
                </h3>
                <div id={`${item.id}-resposta`} className="ih-faq-answer ih-prose" hidden={!expanded}>{item.answer}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="ih-empty">
          <strong>Nenhuma dúvida encontrada</strong>
          <p>Tente outro termo ou use a busca da documentação.</p>
          <button type="button" className="ih-button" onClick={() => { setQuery(''); setCategory('Todas'); }}>Limpar busca</button>
        </div>
      )}
    </div>
  );
}
