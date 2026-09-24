'use client';

import { AnchorProvider, TOCItem, type TableOfContents } from 'fumadocs-core/toc';
import { Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { usePathname } from 'next/navigation';
import { setPendingQuery } from '@/lib/search-query';
import { useAssistant } from '@/components/assistant/assistant-context';

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
  const assistant = useAssistant();
  const pathname = usePathname();
  // O nível mais alto da página vira o primeiro nível do índice (artigos migrados começam em ###).
  const base = toc[0]?.depth ?? 2;
  const items = toc.filter((item) => item.depth <= base + 1);
  // Sem títulos na página, o índice não aparece.
  if (!items.length) return null;

  const askAboutPage = () => {
    if (assistant.enabled) {
      assistant.openDrawer();
      assistant.ask('Resuma esta página em 3 pontos', { page: { path: pathname.replace(/\/$/, ''), title: title ?? '' } });
      return;
    }
    if (title) setPendingQuery(title);
    setOpenSearch(true);
  };

  return (
    <aside className="ih-toc" aria-label="Nesta página">
      <p className="ih-toc-kicker">Nesta página</p>
      <div className="ih-toc-progress" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <AnchorProvider toc={items} single>
          <ul>
            {items.map((item) => (
              <li key={item.url}>
                <TOCItem href={item.url} className="ih-toc-link" data-depth={item.depth - base + 2}>{item.title as ReactNode}</TOCItem>
              </li>
            ))}
          </ul>
      </AnchorProvider>
      {ask ? (
        <button type="button" className="ih-toc-ask" onClick={askAboutPage}>
          <Sparkles aria-hidden="true" />
          Perguntar sobre esta página
        </button>
      ) : null}
    </aside>
  );
}
