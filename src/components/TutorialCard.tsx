import React from 'react';
import styles from './TutorialCard.module.css';

type Props = {
  title: string;
  url: string;
  description?: string;
};

export default function TutorialCard({title, url, description}: Props): JSX.Element {
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
