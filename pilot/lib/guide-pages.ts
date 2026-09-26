import { source } from '@/lib/source';
import { ihelpAppUrl } from '@/lib/links';
import actions from '@/architecture/product-actions.json';

const paths = [
  '/docs/principais-motivos-de-suporte/reconectar-canal-qr',
  '/docs/principais-motivos-de-suporte/usuario-acesso',
  '/docs/sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario',
] as const;

export function canonicalPages() {
  return paths.map((path) => {
    const page = source.getPage(path.slice(1).split('/'));
    if (!page?.data.guide) throw new Error(`Guia canônico ausente: ${path}`);
    const guide = page.data.guide;
    const actionId = guide.steps.find((step) => step.actionId)?.actionId;
    const action = actionId ? actions[actionId as keyof typeof actions] : undefined;
    const app = new URL(action?.route ?? '/atendimento', `${ihelpAppUrl}/`);
    app.searchParams.set('ihelpGuide', guide.guideId);
    return { path, title: page.data.title, description: page.data.description, guide, appUrl: app.toString() };
  });
}
