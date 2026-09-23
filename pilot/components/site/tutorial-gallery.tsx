'use client';

import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useState } from 'react';
import { withBasePath } from '@/lib/shared';

export type Tutorial = {
  title: string;
  description: string;
  embedUrl?: string;
  url?: string;
  category: string;
};

export function TutorialGallery({ tutorials }: { tutorials: Tutorial[] }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const current = tutorials[index];
  if (!current) return null;

  return (
    <div className="ih-tutorials">
      <section className="ih-player" aria-label={`Tutorial: ${current.title}`}>
        <header>
          <div>
            <h2>{current.title}</h2>
            <p>{current.category} · guia publicado no Tango</p>
          </div>
          <a className="ih-button ih-button-primary" href={current.url ?? current.embedUrl ?? '#'} target="_blank" rel="noreferrer noopener">
            <Play aria-hidden="true" />Abrir no Tango
          </a>
        </header>
        <div className="ih-player-frame">
          <span className="ih-player-badge"><span aria-hidden="true" />Guia {index + 1} de {tutorials.length}</span>
          {current.embedUrl && loaded === current.embedUrl ? (
            <iframe
              key={current.embedUrl}
              src={current.embedUrl}
              title={current.title}
              sandbox="allow-scripts allow-top-navigation-by-user-activation allow-popups allow-same-origin"
              allowFullScreen
            />
          ) : current.embedUrl ? (
            <button type="button" className="ih-player-poster" onClick={() => setLoaded(current.embedUrl!)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(current.category === 'CRM' ? '/brand/preview-crm.png' : '/brand/preview-chat.webp')} alt="" />
              <span className="ih-player-start"><Play aria-hidden="true" />Ver o passo a passo aqui</span>
            </button>
          ) : (
            <a className="ih-player-poster" href={current.url} target="_blank" rel="noreferrer noopener">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={withBasePath(current.category === 'CRM' ? '/brand/preview-crm.png' : '/brand/preview-chat.webp')} alt="" />
              <span className="ih-player-start"><Play aria-hidden="true" />Abrir passo a passo no Tango</span>
            </a>
          )}
        </div>
        <footer>
          <p>{current.description}</p>
          <div className="ih-player-controls">
            <button type="button" className="ih-button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
              <ChevronLeft aria-hidden="true" />Anterior
            </button>
            <button type="button" className="ih-button ih-button-dark" onClick={() => setIndex((index + 1) % tutorials.length)}>
              Próximo guia<ChevronRight aria-hidden="true" />
            </button>
            <span className="ih-dots" aria-hidden="true">
              {tutorials.map((tutorial, dot) => <span key={tutorial.url ?? tutorial.embedUrl ?? tutorial.title} data-active={dot === index || undefined} />)}
            </span>
          </div>
        </footer>
      </section>

      <div className="ih-guide-column">
        <p className="ih-eyebrow">Guias disponíveis</p>
        <ul className="ih-guides">
          {tutorials.map((tutorial, item) => (
            <li key={tutorial.url ?? tutorial.embedUrl ?? tutorial.title}>
              <button type="button" className="ih-guide" aria-pressed={item === index} onClick={() => { setIndex(item); setLoaded(null); }}>
                <span className="ih-guide-icon"><Play aria-hidden="true" /></span>
                <span className="ih-guide-copy">
                  <strong>{tutorial.title}</strong>
                  <span>Guia interativo no Tango</span>
                </span>
                <span className="ih-pill" data-kind="tutorial">{tutorial.category}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ih-note-card">
          <strong>Time de suporte</strong>
          <p>Cada guia publicado no Tango entra nesta página. Sentiu falta de algum passo a passo? Peça pelo suporte.</p>
        </div>
      </div>
    </div>
  );
}
