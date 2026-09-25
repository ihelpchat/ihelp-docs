import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { Heading } from 'fumadocs-ui/components/heading';
import type { ComponentProps } from 'react';
import { getMDXComponents } from '@/components/mdx';
import { ArticleLayout, Breadcrumbs } from '@/components/site/article';
import { ApiIntro, ApiResources } from '@/components/site/api-overview';
import { FaqBody } from '@/components/site/faq';
import { NewsList } from '@/components/site/news-list';
import { TutorialsPage } from '@/components/site/tutorials';
import { formatNewsDate, getNews } from '@/lib/news';
import { getPageImageUrl, withBasePath } from '@/lib/shared';
import Link from 'next/link';

// URLs antigas do CRM (uma página por endpoint desde set/2026). O GitHub Pages não faz redirect,
// então cada uma vira uma página estática com meta refresh. A Vercel usa os redirects do vercel.json.
const moved: Record<string, string> = {
  'api/crm/funis-e-etapas': '/api/crm/funis/listar-funis',
  'api/crm/mover-card': '/api/crm/movimentacao/mover-card',
  'api/crm/mover-cards-em-massa': '/api/crm/movimentacao/mover-em-massa',
  'api/crm/trocar-de-funil': '/api/crm/movimentacao/trocar-de-funil',
  'api/crm/mover-por-telefone': '/api/crm/movimentacao/mover-por-telefone',
  'api/crm/referencia': '/api/crm/visao-geral',
  'api/crm/referencia/cards': '/api/crm/cards/criar-card',
  'api/crm/referencia/funis-e-etapas': '/api/crm/funis/listar-funis',
  'api/crm/referencia/pipelines': '/api/crm/pipelines/criar-pipeline',
  'api/crm/referencia/automacoes-e-filtros': '/api/crm/automacoes/listar-automacoes',
};

export default async function Page(props: PageProps<'/[...slug]'>) {
  const params = await props.params;
  const target = moved[params.slug.join('/')];
  if (target) {
    return (
      <div className="ih-page ih-page-narrow">
        <meta httpEquiv="refresh" content={`0;url=${withBasePath(target)}/`} />
        <h1 className="ih-title">Esta página mudou de endereço</h1>
        <p className="ih-lead">
          <Link href={target}>Abrir a página nova</Link>
        </p>
      </div>
    );
  }
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  // Conteúdo migrado costuma abrir as seções com ### ou ####. Descemos todos os títulos o mesmo
  // tanto para o primeiro virar h2 e a ordem ficar correta (h1 → h2 → h3), sem mexer no texto.
  const shift = Math.max(0, (page.data.toc[0]?.depth ?? 2) - 2);
  const level = (depth: number) => `h${Math.max(2, depth - shift)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  const components = getMDXComponents({
    a: createRelativeLink(source, page),
    ...(shift
      ? {
          h3: (heading: ComponentProps<'h3'>) => <Heading as={level(3)} {...heading} />,
          h4: (heading: ComponentProps<'h4'>) => <Heading as={level(4)} {...heading} />,
          h5: (heading: ComponentProps<'h5'>) => <Heading as={level(5)} {...heading} />,
          h6: (heading: ComponentProps<'h6'>) => <Heading as={level(6)} {...heading} />,
        }
      : {}),
  });


  if (page.url === '/tutoriais') {
    return <TutorialsPage title={page.data.title} body={MDX} />;
  }

  if (page.url === '/blog') {
    return (
      <div className="ih-page ih-page-narrow">
        <header className="ih-page-header">
          <h1 className="ih-title">Novidades</h1>
          <p className="ih-lead">Tudo que entrou no iHelp, em ordem: melhorias de produto, mudanças de comportamento e novidades da API.</p>
        </header>
        <NewsList entries={getNews()} />
      </div>
    );
  }

  if (page.url === '/docs/principais-duvidas') {
    return (
      <div className="ih-page ih-page-faq">
        <p className="ih-crumb-text">Central de ajuda · Dúvidas e dicas</p>
        <h1 className="ih-title">{page.data.title}</h1>
        <p className="ih-lead">{page.data.description}</p>
        <FaqBody body={MDX} components={components} />
      </div>
    );
  }

  if (page.url === '/api') {
    return (
      <ArticleLayout page={page} toc={[]} meta={false} wide intro={<ApiIntro title={page.data.title} description={page.data.description} />}>
        <MDX components={components} />
        <ApiResources />
      </ArticleLayout>
    );
  }

  if (page.url.startsWith('/blog/') && page.data.date) {
    return (
      <ArticleLayout
        page={page}
        toc={page.data.toc}
        meta={false}
        intro={
          <>
            <Breadcrumbs page={page} />
            <p className="ih-timeline-meta"><time dateTime={page.data.date.toISOString()}>{formatNewsDate(page.data.date)}</time></p>
            <h1 className="ih-title">{page.data.title}</h1>
            <p className="ih-lead">{page.data.description}</p>
          </>
        }
      >
        <MDX components={components} />
      </ArticleLayout>
    );
  }

  return (
    <ArticleLayout page={page} toc={page.data.toc} meta={!page.url.startsWith('/api')}>
      <MDX components={components} />
    </ArticleLayout>
  );
}

export async function generateStaticParams() {
  const params = source.generateParams();
  for (const [from, to] of Object.entries(moved)) {
    if (source.getPage(from.split('/'))) throw new Error(`Redirect sobre página existente: ${from}`);
    if (!source.getPage(to.slice(1).split('/'))) throw new Error(`Redirect para página inexistente: ${to}`);
  }
  return [...params, ...Object.keys(moved).map((from) => ({ slug: from.split('/') }))];
}

export async function generateMetadata(props: PageProps<'/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
  const target = moved[params.slug.join('/')];
  if (target) return { title: 'Página movida', robots: { index: false }, alternates: { canonical: target } };
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      images: getPageImageUrl(page).url,
    },
  };
}
