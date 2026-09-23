import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/** Link de navegação em destaque dentro do conteúdo (substitui os antigos <a class="button">). */
export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:\/\//.test(href);
  const content = (
    <>
      <span>{children}</span>
      <ChevronRight aria-hidden="true" />
    </>
  );
  return external ? (
    <a className="ih-link-row" href={href} target="_blank" rel="noreferrer noopener">{content}</a>
  ) : (
    <Link className="ih-link-row" href={href}>{content}</Link>
  );
}
