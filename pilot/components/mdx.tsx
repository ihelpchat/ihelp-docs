import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import type { ComponentProps } from 'react';
import type { MDXComponents } from 'mdx/types';
import { ButtonLink } from '@/components/site/button-link';
import { Callout } from '@/components/site/callout';
import { Field, Fields, Param, Params, StepCard, StepCards } from '@/components/site/api-blocks';
import { CodeTabs, Response } from '@/components/site/api-code';
import { TutorialCard } from '@/components/tutorial-card';
import { VideoEmbed } from '@/components/video-embed';

// Listas quebradas por imagens recomeçam com start="N"; o contador dos círculos precisa seguir o número.
function OrderedList({ start, style, ...props }: ComponentProps<'ol'>) {
  const counter = start && start > 1 ? { counterReset: `ih-step ${start - 1}` } : undefined;
  return <ol start={start} style={{ ...counter, ...style }} {...props} />;
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    ButtonLink,
    Callout,
    CodeTabs,
    Field,
    Fields,
    Param,
    Params,
    Response,
    StepCard,
    StepCards,
    ol: OrderedList,
    TutorialCard,
    VideoEmbed,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
