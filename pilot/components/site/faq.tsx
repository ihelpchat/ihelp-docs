import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';
import { getMDXComponents } from '@/components/mdx';
import { FaqList, type FaqItem } from '@/components/site/faq-list';
import { firstHref, nodeText } from '@/lib/react-text';

function FaqQuestion(props: ComponentProps<'h3'>) {
  return <h3 {...props} />;
}

function FaqSection(props: ComponentProps<'h2'>) {
  return <h2 {...props} />;
}

function FaqRule() {
  return null;
}

function categoryFor(href: string | undefined) {
  if (!href) return 'Geral';
  if (href.startsWith('/api')) return 'API';
  if (href.includes('whatsapp')) return 'WhatsApp';
  if (href.includes('primeiros-passos') || href.includes('senha')) return 'Acesso';
  if (href.includes('campanhas')) return 'Campanhas';
  if (href.includes('contatos')) return 'Contatos';
  if (href.includes('configuracoes')) return 'Configurações';
  if (href.includes('atendimento')) return 'Atendimento';
  return 'Geral';
}

type MdxBody = (props: { components?: MDXComponents }) => ReactElement<{ children?: ReactNode }>;

/**
 * Renderiza a página de perguntas frequentes como lista filtrável.
 * O MDX continua sendo a fonte: cada `###` vira uma pergunta e o que vem até o próximo `###` vira a resposta.
 */
export function FaqBody({ body, components }: { body: unknown; components: MDXComponents }) {
  const rendered = (body as MdxBody)({ components: { ...getMDXComponents(components), h2: FaqSection, h3: FaqQuestion, hr: FaqRule } });
  const nodes = Children.toArray(rendered.props.children).filter((node) => typeof node !== 'string' || node.trim());

  const items: FaqItem[] = [];
  const outro: ReactNode[] = [];
  let current: { id: string; question: ReactNode; answer: ReactNode[] } | undefined;
  let finished = false;

  const flush = () => {
    if (!current) return;
    const question = nodeText(current.question).replace(/^\s*\d+\.\s*/, '').trim();
    items.push({
      id: current.id,
      question,
      category: categoryFor(firstHref(current.answer)),
      text: `${question} ${nodeText(current.answer)}`.toLocaleLowerCase('pt-BR'),
      answer: current.answer,
    });
    current = undefined;
  };

  for (const node of nodes) {
    if (!isValidElement<{ id?: string; children?: ReactNode }>(node)) {
      (finished || !current ? outro : current.answer).push(node);
      continue;
    }
    if (node.type === FaqQuestion && !finished) {
      flush();
      current = { id: node.props.id ?? `pergunta-${items.length + 1}`, question: node.props.children, answer: [] };
    } else if (node.type === FaqRule) {
      continue;
    } else if (node.type === FaqSection) {
      flush();
      finished = true;
      outro.push(node);
    } else if (current && !finished) {
      current.answer.push(node);
    } else {
      outro.push(node);
    }
  }
  flush();

  return (
    <>
      <FaqList items={items} />
      {outro.length ? <div className="ih-prose ih-faq-outro">{outro}</div> : null}
    </>
  );
}
