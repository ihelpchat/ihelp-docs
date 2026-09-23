import Link from 'next/link';
import { ChevronRight, Clock } from 'lucide-react';
import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb';
import { findParent } from 'fumadocs-core/page-tree';
import type { TableOfContents } from 'fumadocs-core/toc';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { PageToc } from '@/components/site/toc';
import { Feedback } from '@/components/site/feedback';
import { CopyButton } from '@/components/site/copy-button';

const apiBase = 'https://apiv3.ihelpchat.com/api/v2';
const updatedFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

type Page = NonNullable<ReturnType<typeof source.getPage>>;

const contentLabel = { faq: 'Perguntas frequentes', tutorial: 'Tutorial', guia: 'Guia', referencia: 'Referência' } as const;

/** O padrão editorial repete a descrição como 1º parágrafo; na página ela já aparece como subtítulo. */
export async function repeatsDescription(page: Page) {
  const raw = await page.data.getText('raw');
  const body = raw.replace(/^---[\s\S]*?---\s*/, '').trimStart();
  const first = body.split(/\n\s*\n/)[0]?.trim() ?? '';
  return first === page.data.description.trim();
}

export async function readingMinutes(page: Page) {
  const text = await page.data.getText('processed');
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 200));
}

export function Breadcrumbs({ page }: { page: Page }) {
  const section = page.url.split('/')[1];
  const rootLabel = section === 'api' ? 'Referência da API' : section === 'blog' ? 'Novidades' : section === 'tutoriais' ? 'Tutoriais' : 'Central de ajuda';
  const items = getBreadcrumbItems(page.url, source.getPageTree(), { includePage: true }).filter((item) => item.url !== `/${section}`);
  return (
    <nav className="ih-breadcrumb" aria-label="Você está em">
      <Link href={`/${section}`}>{rootLabel}</Link>
      {items.map((item, index) => (
        <span key={`${String(item.name)}-${index}`} className="ih-breadcrumb-item">
          <ChevronRight aria-hidden="true" />
          {item.url && index < items.length - 1 ? <Link href={item.url}>{item.name}</Link> : <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.name}</span>}
        </span>
      ))}
    </nav>
  );
}

function ContinueReading({ page }: { page: Page }) {
  const parent = findParent(source.getPageTree(), page.url);
  if (!parent) return null;
  const siblings = parent.children
    .flatMap((node) => (node.type === 'page' ? [node] : node.type === 'folder' && node.index ? [node.index] : []))
    .filter((node) => node.url !== page.url)
    .slice(0, 3);
  if (!siblings.length) return null;
  const kicker = 'name' in parent && parent.name ? parent.name : 'Central de ajuda';
  return (
    <section className="ih-related" aria-labelledby="continue-lendo">
      <p id="continue-lendo" className="ih-eyebrow">Continue lendo</p>
      <div className="ih-related-grid">
        {siblings.map((node) => (
          <Link key={node.url} href={node.url}>
            <span>{kicker}</span>
            <strong>{node.name}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}

export async function ArticleLayout({
  page,
  toc,
  children,
  intro,
  meta = true,
  wide = false,
}: {
  page: Page;
  toc: TableOfContents;
  children: ReactNode;
  intro?: ReactNode;
  meta?: boolean;
  wide?: boolean;
}) {
  const minutes = meta ? await readingMinutes(page) : 0;
  const hideFirst = await repeatsDescription(page);
  const api = page.url.startsWith('/api');

  return (
    <div className={wide ? 'ih-article-wrap ih-article-wide' : 'ih-article-wrap'}>
      <article className={page.data.method ? 'ih-article ih-article-endpoint' : 'ih-article'}>
        {intro ?? (
          <>
            {api && page.data.method ? (
              <p className="ih-endpoint-kicker">
                <span className="ih-method" data-method={page.data.method}>{page.data.method}</span>
                <code>{page.data.endpoint}</code>
              </p>
            ) : (
              <Breadcrumbs page={page} />
            )}
            <h1 className="ih-title">{page.data.title}</h1>
            <p className="ih-lead">{page.data.description}</p>
            {api && page.data.method && page.data.endpoint ? (
              <div className="ih-url-bar">
                <span className="ih-method" data-method={page.data.method}>{page.data.method}</span>
                <code>{apiBase}{page.data.endpoint}</code>
                <CopyButton value={`${apiBase}${page.data.endpoint}`} />
              </div>
            ) : null}
            {meta ? (
              <div className="ih-meta">
                <span><Clock aria-hidden="true" />{minutes} min de leitura</span>
                {page.data.lastModified ? <span>Atualizado em {updatedFormat.format(page.data.lastModified)}</span> : null}
                <span className="ih-meta-pill"><span aria-hidden="true" />{contentLabel[page.data.contentType]}</span>
              </div>
            ) : null}
          </>
        )}
        <div className="ih-prose" data-skip-lead={hideFirst || undefined}>{children}</div>
        {api ? null : <Feedback />}
        <ContinueReading page={page} />
      </article>
      {wide ? null : <PageToc toc={toc} title={page.data.title} />}
    </div>
  );
}
