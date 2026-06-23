import React, { useState } from 'react';
import styles from './TutorialCard.module.css';

type Props = {
  title: string;
  url: string;
  description?: string;
  embedUrl?: string;
};

export default function TutorialCard({ title, url, description, embedUrl }: Props): JSX.Element {
  const [open, setOpen] = useState(false);

  if (embedUrl) {
    return (
      <>
        <button className={styles.card} onClick={() => setOpen(true)}>
          <span className={styles.icon}>🎓</span>
          <div className={styles.content}>
            <span className={styles.title}>{title}</span>
            {description && <span className={styles.description}>{description}</span>}
          </div>
          <span className={styles.cta}>Abrir tutorial →</span>
        </button>

        {open && (
          <div className={styles.overlay} onClick={() => setOpen(false)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <button className={styles.close} onClick={() => setOpen(false)}>✕</button>
              <iframe
                src={embedUrl}
                sandbox="allow-scripts allow-top-navigation-by-user-activation allow-popups allow-same-origin"
                title={title}
                width="100%"
                referrerPolicy="strict-origin-when-cross-origin"
                frameBorder="0"
                allowFullScreen
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.card}
    >
      <span className={styles.icon}>🎓</span>
      <div className={styles.content}>
        <span className={styles.title}>{title}</span>
        {description && <span className={styles.description}>{description}</span>}
      </div>
      <span className={styles.cta}>Abrir tutorial →</span>
    </a>
  );
}
