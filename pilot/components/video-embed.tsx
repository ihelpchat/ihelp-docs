type VideoEmbedProps = {
  url: string;
  title?: string;
};

export function VideoEmbed({ url, title = 'Vídeo tutorial do iHelp' }: VideoEmbedProps) {
  const isExternal = url.startsWith('http');

  if (isExternal) {
    return (
      <div className="video-embed">
        <iframe src={url} title={title} loading="lazy" allowFullScreen />
      </div>
    );
  }

  return (
    <div className="video-embed">
      <video controls preload="metadata" aria-label={title}>
        <source src={withBasePath(url)} />
        Seu navegador não consegue reproduzir este vídeo.
      </video>
    </div>
  );
}
import { withBasePath } from '@/lib/shared';
