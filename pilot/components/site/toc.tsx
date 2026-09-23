'use client';

import { AnchorProvider, TOCItem, type TableOfContents } from 'fumadocs-core/toc';
import { Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { setPendingQuery } from '@/lib/search-query';

function useReadingProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return progress;
}

export function PageToc({ toc, title, ask = true }: { toc: TableOfContents; title?: string; ask?: boolean }) {
  const progress = useReadingProgress();
  const { setOpenSearch } = useSearchContext();
  // O nível mais alto da página vira o primeiro nível do índice (artigos migrados começam em ###).
  const base = toc[0]?.depth ?? 2;
  const items = toc.filter((item) => item.depth <= base + 1);

  return (
    <aside className="ih-toc" aria-label="Nesta página">
      <p className="ih-toc-kicker">Nesta página</p>
      <div className="ih-toc-progress" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      {items.length ? (
        <AnchorProvider toc={items} single>
          <ul>
            {items.map((item) => (
              <li key={item.url}>
                <TOCItem href={item.url} className="ih-toc-link" data-depth={item.depth - base + 2}>{item.title as ReactNode}</TOCItem>
              </li>
            ))}
          </ul>
        </AnchorProvider>
      ) : null}
      {ask ? (
        <button type="button" className="ih-toc-ask" onClick={() => {
          if (title) setPendingQuery(title);
          setOpenSearch(true);
        }}>
          <Sparkles aria-hidden="true" />
          Perguntar sobre esta página
        </button>
      ) : null}
    </aside>
  );
}
