'use client';

import { ArrowRight, ExternalLink, Play, X } from 'lucide-react';
import { useRef } from 'react';

type TutorialCardProps = {
  title: string;
  description: string;
  embedUrl?: string;
  url?: string;
  compact?: boolean;
};

export function TutorialCard({ title, description, embedUrl, url }: TutorialCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canEmbed = Boolean(embedUrl);

  return (
    <>
      <div className="ih-tango-banner">
        <span className="ih-tango-icon"><Play aria-hidden="true" /></span>
        <div className="ih-tango-copy">
          <strong>Tutorial guiado: {title}</strong>
          <span>{description}</span>
        </div>
        {canEmbed ? (
          <button type="button" className="ih-button ih-button-primary" onClick={() => dialogRef.current?.showModal()}>
            Ver passo a passo <ArrowRight aria-hidden="true" />
          </button>
        ) : url ? (
          <a href={url} target="_blank" rel="noreferrer noopener" className="ih-button ih-button-primary">
            Abrir no Tango <ExternalLink aria-hidden="true" />
          </a>
        ) : null}
      </div>

      {canEmbed ? <dialog ref={dialogRef} className="tutorial-dialog" aria-label={title}>
        <div className="tutorial-dialog-header">
          <div>
            <span>Tutorial guiado</span>
            <strong>{title}</strong>
          </div>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer noopener">
              Abrir no Tango <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          <button type="button" aria-label="Fechar tutorial" onClick={() => dialogRef.current?.close()}>
            <X aria-hidden="true" />
          </button>
        </div>
        <iframe
          src={embedUrl!}
          title={title}
          loading="lazy"
          sandbox="allow-scripts allow-top-navigation-by-user-activation allow-popups allow-same-origin"
          allowFullScreen
        />
      </dialog> : null}
    </>
  );
}
