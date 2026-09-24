import { ArrowUpRight } from 'lucide-react';
import { productActionUrl } from '@/lib/links';

type ProductActionProps = {
  id: string;
  label: string;
  route: string;
  target?: string;
};

export function ProductAction({ id, label, route }: ProductActionProps) {
  return (
    <a className="ih-product-action" href={productActionUrl(route, id)} target="_blank" rel="noreferrer noopener">
      <span>
        <strong>{label}</strong>
        <small>Abra o iHelp exatamente na tela deste passo</small>
      </span>
      <ArrowUpRight aria-hidden="true" />
    </a>
  );
}
