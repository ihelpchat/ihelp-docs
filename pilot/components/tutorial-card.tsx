'use client';

import { ExternalLink, Play, X } from 'lucide-react';
import { useRef } from 'react';

type TutorialCardProps = {
  title: string;
  description: string;
  embedUrl: string;
  url?: string;
  compact?: boolean;
};

export function TutorialCard({ title, description, embedUrl, url, compact = false }: TutorialCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <article className={`tutorial-card${compact ? ' tutorial-card-compact' : ''}`}>
        <span className="tutorial-icon"><Play aria-hidden="true" /></span>
        <div>
          <span className="tutorial-label">Tutorial guiado</span>
          {compact ? null : <h3>{title}</h3>}
          {compact ? null : <p>{description}</p>}
          <div className="tutorial-actions">
            <button type="button" onClick={() => dialogRef.current?.showModal()}>
              Ver passo a passo <Play aria-hidden="true" />
            </button>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer noopener">
                Abrir no Tango <ExternalLink aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      </article>

      <dialog ref={dialogRef} className="tutorial-dialog" aria-label={title}>
        <div className="tutorial-dialog-header">
          <div>
            <span>Tutorial guiado</span>
            <strong>{title}</strong>
          </div>
          <button type="button" aria-label="Fechar tutorial" onClick={() => dialogRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </div>
        <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          sandbox="allow-scripts allow-top-navigation-by-user-activation allow-popups allow-same-origin"
          allowFullScreen
        />
      </dialog>
    </>
  );
}
