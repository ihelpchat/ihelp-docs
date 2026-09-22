import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { getMDXComponents } from '@/components/mdx';
import { ArticleLayout, Breadcrumbs } from '@/components/site/article';
import { ApiIntro, ApiResources } from '@/components/site/api-overview';
import { FaqBody } from '@/components/site/faq';
import { NewsList } from '@/components/site/news-list';
import { TutorialsPage } from '@/components/site/tutorials';
import { formatNewsDate, getNews } from '@/lib/news';
import { getPageImageUrl } from '@/lib/shared';

export default async function Page(props: PageProps<'/[...slug]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const components = getMDXComponents({ a: createRelativeLink(source, page) });

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
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
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
