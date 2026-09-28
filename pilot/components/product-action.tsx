import { ArrowRight } from 'lucide-react';
import { productActionUrl } from '@/lib/links';
import allowedActions from '@/architecture/product-actions.json';
import coverage from '@/architecture/coverage-matrix.json';

type ProductActionProps = {
  id: string;
  label: string;
  route: string;
  target?: string;
};

export function ProductAction({ id, route, target }: ProductActionProps) {
  const href = productActionUrl(route, id, target);
  if (!href) return null;
  const menuModule = coverage.find((item) => item.productRoutes.includes(route))?.module;
  const label = menuModule && !menuModule.includes(' — ') ? `Abrir o módulo ${menuModule}`
    : (allowedActions as Record<string, { label: string }>)[id].label;
  return (
    <a id={`guia-${id}`} className="ih-ai-product-action" href={href} target="_blank" rel="noreferrer noopener">
      {label}<ArrowRight aria-hidden="true" />
    </a>
  );
}
