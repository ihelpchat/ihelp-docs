import { withBasePath } from '@/lib/shared';

export function TechnologyMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="ih-tech-mark" data-compact={compact || undefined} aria-label="Uma tecnologia iHelp">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={withBasePath('/img/favicon.png')} alt="" width="18" height="18" />
      <span>Uma tecnologia</span>
      <strong>iHelp</strong>
    </span>
  );
}
