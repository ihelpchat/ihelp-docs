import { ArrowUpRight } from 'lucide-react';
import { productActionUrl } from '@/lib/links';
import allowedActions from '@/architecture/product-actions.json';

type ProductActionProps = {
  id: string;
  label: string;
  route: string;
  target?: string;
};

export function ProductAction({ id, route, target }: ProductActionProps) {
  const href = productActionUrl(route, id, target);
  if (!href) return null;
  const label = (allowedActions as Record<string, { label: string }>)[id].label;
  const destination = label.replace(/^Abrir\s+/i, '').replace(/[.!?]+$/, '');
  return (
    <a className="ih-product-action" href={href} target="_blank" rel="noreferrer noopener">
      <span>
        <strong>{label}</strong>
        <small>Abre {destination} no iHelp e destaca onde começar.</small>
      </span>
      <ArrowUpRight aria-hidden="true" />
    </a>
  );
}
