'use client';

import { useRouter } from 'next/navigation';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import type { SharedProps } from 'fumadocs-ui/contexts/search';
import { takePendingQuery } from '@/lib/search-query';
import { withBasePath } from '@/lib/shared';

export type SiteCounts = { articles: number; endpoints: number; news: number };

type Kind = 'Ajuda' | 'FAQ' | 'API' | 'Tutorial' | 'Novidade';
type Result = { id: string; url: string; title: string; path: string; kind: Kind };

const tabs = ['Tudo', 'Ajuda', 'API', 'Tutoriais', 'Novidades'] as const;
type Tab = (typeof tabs)[number];

const popular: Result[] = [
  { id: 'p1', kind: 'Ajuda', title: 'Transferir um atendimento', path: 'Central de ajuda › Sobre o sistema › Atendimento', url: '/docs/sobre-o-sistema/atendimento#como-transferir-um-atendimento' },
  { id: 'p2', kind: 'API', title: 'Autenticação · Bearer token', path: 'API › Conceitos › Autenticação', url: '/api/conceitos/autenticacao' },
  { id: 'p3', kind: 'API', title: 'GET /customers/search', path: 'API › Atendimentos › Buscar atendimento pelo telefone', url: '/api/atendimentos/buscar-atendimento-por-telefone' },
  { id: 'p4', kind: 'Tutorial', title: 'Tutoriais guiados no Tango', path: 'Tutoriais › Guias interativos', url: '/tutoriais' },
  { id: 'p5', kind: 'FAQ', title: 'Principais dúvidas', path: 'Central de ajuda › Principais dúvidas', url: '/docs/principais-duvidas' },
  { id: 'p6', kind: 'Novidade', title: 'Encerramento automático e novos filtros', path: 'Novidades', url: '/blog/encerramento-automatico-e-filtros' },
];

function kindOf(url: string): Kind {
  if (url.startsWith('/api')) return 'API';
  if (url.startsWith('/tutoriais')) return 'Tutorial';
  if (url.startsWith('/blog')) return 'Novidade';
  if (url.startsWith('/docs/principais-duvidas')) return 'FAQ';
  return 'Ajuda';
}

function inTab(kind: Kind, tab: Tab) {
  if (tab === 'Tudo') return true;
  if (tab === 'Ajuda') return kind === 'Ajuda' || kind === 'FAQ';
  if (tab === 'API') return kind === 'API';
  if (tab === 'Tutoriais') return kind === 'Tutorial';
  return kind === 'Novidade';
}

function plain(value: unknown) {
  return String(value ?? '').replace(/<\/?mark>/g, '').replace(/[*_`]/g, '').trim();
}

const rootNames = new Set(['Docs', 'Central de ajuda', 'Referência da API', 'Novidades', 'Tutoriais']);

function trail(kind: Kind, crumbs: unknown[] | undefined, page?: string) {
  const rest = (crumbs ?? []).map(plain).filter((crumb) => crumb && !rootNames.has(crumb));
  return [sectionLabel[kind], ...rest, ...(page ? [page] : [])].join(' › ');
}

const sectionLabel: Record<Kind, string> = { Ajuda: 'Central de ajuda', FAQ: 'Central de ajuda', API: 'API', Tutorial: 'Tutoriais', Novidade: 'Novidades' };

export default function SearchDialog({ open, onOpenChange, counts }: SharedProps & { counts?: SiteCounts }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>('Tudo');
  const [selected, setSelected] = useState(0);
  const { search, setSearch, query } = useDocsSearch({ client: staticClient({}) });

  useEffect(() => {
    if (!open) return;
    const pending = takePendingQuery();
    // A busca pode abrir já com uma pergunta sugerida (chips da home).
    if (pending !== undefined) setSearch(pending);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, setSearch]);

  const results = useMemo<Result[]>(() => {
    if (!search.trim()) return popular;
    if (!Array.isArray(query.data)) return [];
    const titles = new Map<string, string>();
    const seen = new Set<string>();
    const out: Result[] = [];
    for (const item of query.data) {
      const page = item.url.split('#')[0];
      if (item.type === 'page') titles.set(page, plain(item.content));
      if (item.type === 'text') continue;
      const title = plain(item.content);
      // A página e o título principal dela costumam vir repetidos; mostramos uma vez.
      if (seen.has(`${page}|${title}`)) continue;
      seen.add(`${page}|${title}`);
      const kind = kindOf(item.url);
      out.push({
        id: item.id,
        url: item.url,
        kind,
        title,
        path: item.type === 'page' ? trail(kind, item.breadcrumbs) : trail(kind, [], titles.get(page)),
      });
    }
    return out;
  }, [search, query.data]);

  const visible = results.filter((result) => inTab(result.kind, tab)).slice(0, 12);
  const active = Math.min(selected, Math.max(0, visible.length - 1));

  const go = (result: Result | undefined) => {
    if (!result) return;
    onOpenChange(false);
    router.push(result.url);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onOpenChange(false);
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((active + 1) % Math.max(1, visible.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((active - 1 + visible.length) % Math.max(1, visible.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(visible[active]);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="ih-search-overlay" onMouseDown={() => onOpenChange(false)}>
      <div
        className="ih-search"
        role="dialog"
        aria-modal="true"
        aria-label="Buscar na documentação"
        id="ih-search-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="ih-search-input">
          <Sparkles aria-hidden="true" />
          <input
            ref={inputRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected(0);
            }}
            placeholder="Buscar artigos, endpoints ou perguntar com suas palavras"
            aria-label="Buscar na documentação"
            data-search-input
          />
          <button type="button" className="ih-button ih-button-primary ih-button-sm" onClick={() => go(visible[active])}>
            Abrir <span aria-hidden="true">↵</span>
          </button>
        </div>
        <div className="ih-search-tabs" role="tablist" aria-label="Filtrar resultados">
          {tabs.map((name) => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => { setTab(name); setSelected(0); }}>{name}</button>
          ))}
        </div>
        <div className="ih-search-results">
          <p className="ih-eyebrow">{search.trim() ? `Resultados para “${search.trim()}”` : 'Mais acessados'}</p>
          {search.trim() && query.isLoading && !visible.length ? <p className="ih-search-empty">Buscando…</p> : null}
          {search.trim() && !query.isLoading && !visible.length ? (
            <p className="ih-search-empty">Nenhum resultado. Tente outras palavras ou fale com o suporte.</p>
          ) : null}
          <ul>
            {visible.map((result, index) => (
              <li key={`${result.id}-${index}`}>
                <a
                  href={withBasePath(result.url)}
                  className="ih-search-result"
                  data-selected={index === active || undefined}
                  onMouseEnter={() => setSelected(index)}
                  onClick={(event) => {
                    event.preventDefault();
                    go(result);
                  }}
                >
                  <span className="ih-pill" data-kind={result.kind}>{result.kind}</span>
                  <span className="ih-search-copy">
                    <strong>{result.title}</strong>
                    <span>{result.path}</span>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="ih-search-footer">
          <span><kbd>↵</kbd> abrir</span>
          <span><kbd>esc</kbd> fechar</span>
          {counts ? <span className="ih-search-count">Busca em {counts.articles} artigos, {counts.endpoints} endpoints e {counts.news} novidades</span> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
