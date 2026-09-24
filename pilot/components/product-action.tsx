import { ArrowUpRight } from 'lucide-react';
import { productActionUrl } from '@/lib/links';

type ProductActionProps = {
  id: string;
  label: string;
  route: string;
  target?: string;
};

export function ProductAction({ id, label, route, target }: ProductActionProps) {
  const href = productActionUrl(route, id, target);
  if (!href) return null;
  return (
    <a className="ih-product-action" href={href} target="_blank" rel="noreferrer noopener">
      <span>
        <strong>{label}</strong>
        <small>Abre a tela Contatos no iHelp; use o menu de três pontos para importar.</small>
      </span>
      <ArrowUpRight aria-hidden="true" />
    </a>
  );
}
