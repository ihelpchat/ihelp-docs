'use client';

import { useState } from 'react';
import { useAssistant } from '@/components/assistant/assistant-context';
import { supportLink } from '@/lib/links';
import { assistantDisplayName } from '@/lib/assistant-name';
import { withBasePath } from '@/lib/shared';

export function OriginLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <a className={className} href={withBasePath(href)} onClick={(event) => {
    if (new URLSearchParams(window.location.search).get('origem') !== 'suporte') return;
    const url = new URL(event.currentTarget.href);
    url.searchParams.set('origem', 'suporte');
    event.currentTarget.href = url.toString();
  }}>{children}</a>;
}

export function GuideCatalog({ pages }: { pages: { path: string; title: string; description: string }[] }) {
  return (
    <section className="ih-guide-catalog" aria-label="Guias por tema">
      {pages.map((page) => (
        <OriginLink key={page.path} href={page.path} className="ih-guide-card">
          <strong>{page.title}</strong><span>{page.description}</span>
        </OriginLink>
      ))}
    </section>
  );
}

export function GuideExperience({ guideId, appUrl, steps }: {
  guideId: string;
  appUrl: string;
  steps: { stepId: string; text: string }[];
}) {
  const { openDrawer } = useAssistant();
  const [phone, setPhone] = useState<'android' | 'iphone' | null>(null);
  const selected = steps.find((step) => step.stepId === phone);
  const stepId = selected?.stepId ?? steps[0]?.stepId;
  const help = supportLink({ guide: stepId ? { guideId, stepId } : undefined });
  return (
    <section className="ih-guide-page" aria-label="Acompanhar este guia" data-guide-id={guideId} data-step-id={stepId}>
      <OriginLink href="/docs/guias" className="ih-guide-back">Ver todos os guias</OriginLink>
      <div className="ih-guide-actions">
        <a className="ih-guide-app" href={appUrl} target="_blank" rel="noreferrer noopener">Fazer no app</a>
        <button type="button" onClick={openDrawer}>Perguntar à {assistantDisplayName}</button>
        <a href={help} target="_blank" rel="noreferrer noopener">Falar com uma pessoa</a>
      </div>
      {steps.some((step) => step.stepId === 'android') && steps.some((step) => step.stepId === 'iphone') ? (
        <div className="ih-guide-phone">
          <p>Qual celular você usa?</p>
          {phone ? <button type="button" onClick={() => setPhone(null)}>Voltar</button> : (
            <div className="ih-guide-phone-options">
              <button type="button" onClick={() => setPhone('android')}>Uso Android</button>
              <button type="button" onClick={() => setPhone('iphone')}>Uso iPhone</button>
            </div>
          )}
          {selected ? <p aria-live="polite">{selected.text}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
