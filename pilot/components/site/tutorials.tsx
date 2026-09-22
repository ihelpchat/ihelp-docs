import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';
import { getMDXComponents } from '@/components/mdx';
import { TutorialGallery, type Tutorial } from '@/components/site/tutorial-gallery';
import { nodeText } from '@/lib/react-text';

function TutorialGroup(props: ComponentProps<'h2'>) {
  return <h2 {...props} />;
}

function TutorialEntry(props: Omit<Tutorial, 'category'>) {
  void props;
  return null;
}

type MdxBody = (props: { components?: MDXComponents }) => ReactElement<{ children?: ReactNode }>;

/** Lista os `<TutorialCard>` do MDX de tutoriais, agrupados pelo `##` anterior. */
export function extractTutorials(body: unknown): Tutorial[] {
  const rendered = (body as MdxBody)({ components: { ...getMDXComponents(), h2: TutorialGroup, TutorialCard: TutorialEntry } });
  const tutorials: Tutorial[] = [];
  let category = 'Geral';
  const walk = (node: ReactNode) => {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(child)) continue;
      if (child.type === TutorialGroup) category = nodeText(child.props.children).trim();
      else if (child.type === TutorialEntry) {
        const props = child.props as unknown as Omit<Tutorial, 'category'>;
        tutorials.push({ title: props.title, description: props.description, embedUrl: props.embedUrl, url: props.url, category });
      } else walk(child.props.children);
    }
  };
  walk(rendered.props.children);
  return tutorials;
}

export function TutorialsPage({ title, body }: { title: string; body: unknown }) {
  const tutorials = extractTutorials(body);
  return (
    <div className="ih-page ih-page-wide">
      <header className="ih-page-header ih-page-header-split">
        <div>
          <h1 className="ih-title">{title}</h1>
          <p className="ih-lead">Guias interativos que mostram cada clique dentro do iHelp. Acompanhe aqui o passo a passo ou abra o guia no Tango.</p>
        </div>
        <p className="ih-status-pill"><span aria-hidden="true" />{tutorials.length} guias publicados no Tango</p>
      </header>
      <TutorialGallery tutorials={tutorials} />
    </div>
  );
}
