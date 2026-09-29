import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function GuideActionLink({ href, children, className = '' }: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return <a className={`ih-ai-product-action ${className}`.trim()} href={href} target="_blank" rel="noreferrer noopener">
    {children}<ArrowRight aria-hidden="true" />
  </a>;
}
