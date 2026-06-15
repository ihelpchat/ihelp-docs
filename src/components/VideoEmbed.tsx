import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './VideoEmbed.module.css';

type Props = {
  /** URL do vídeo: arquivo local (/videos/...mp4), YouTube ou tella.tv */
  url: string;
  title?: string;
};

function youtubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}

function tellaId(url: string): string | null {
  const m = url.match(/tella\.tv\/video\/([\w-]+)/);
  return m ? m[1] : null;
}

/**
 * Player de vídeo unificado:
 * - arquivos .mp4 locais → <video> HTML5 (self-hosted em static/videos)
 * - YouTube → iframe embed
 * - tella.tv → iframe embed
 * - qualquer outra coisa → link simples (fallback)
 */
export default function VideoEmbed({url, title = 'Vídeo'}: Props): JSX.Element {
  // useBaseUrl devolve URLs externas (com protocolo) inalteradas e prefixa as locais.
  const resolved = useBaseUrl(url);

  if (/\.mp4($|\?)/.test(url)) {
    return (
      <div className={styles.videoWrapper}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video className={styles.video} controls preload="metadata">
          <source src={resolved} type="video/mp4" />
          Seu navegador não suporta vídeo embutido.{' '}
          <a href={resolved}>Baixe o vídeo</a>.
        </video>
      </div>
    );
  }

  const yt = youtubeId(url);
  if (yt) {
    return (
      <div className={styles.videoWrapper}>
        <iframe
          className={styles.iframe}
          src={`https://www.youtube-nocookie.com/embed/${yt}`}
          title={title}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  const tella = tellaId(url);
  if (tella) {
    return (
      <div className={styles.videoWrapper}>
        <iframe
          className={styles.iframe}
          src={`https://www.tella.tv/video/${tella}/embed?b=0&title=0&a=1&loop=0&t=0&muted=0&wt=0`}
          title={title}
          frameBorder="0"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <p>
      🎬 <a href={url} target="_blank" rel="noopener noreferrer">{title}</a>
    </p>
  );
}
