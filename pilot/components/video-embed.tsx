import { withBasePath } from '@/lib/shared';

type VideoEmbedProps = {
  url: string;
  title?: string;
};

function embedUrl(url: string) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  if (match) return `https://www.youtube-nocookie.com/embed/${match[1]}`;
  const tella = url.match(/^https:\/\/www\.tella\.tv\/video\/([^/?#]+)/);
  return tella ? `https://www.tella.tv/video/${tella[1]}/embed` : undefined;
}

export function VideoEmbed({ url, title = 'Vídeo tutorial do iHelp' }: VideoEmbedProps) {
  if (url.startsWith('http')) {
    return (
      <figure className="ih-media video-embed">
        <iframe src={embedUrl(url) ?? url} title={title} loading="lazy" allowFullScreen />
      </figure>
    );
  }

  return (
    <figure className="ih-media video-embed">
      <video controls preload="metadata" aria-label={title}>
        <source src={withBasePath(url)} />
        Seu navegador não consegue reproduzir este vídeo.
      </video>
    </figure>
  );
}
