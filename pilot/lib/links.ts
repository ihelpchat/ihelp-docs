import { resolveCatalogAction } from '../architecture/catalog-action.mjs';

export const supportUrl = 'https://wa.me/551730422307';
export const supportPhone = '(17) 3042-2307';
export const ihelpAppUrl = process.env.NEXT_PUBLIC_IHELP_APP_URL?.replace(/\/$/, '') || 'https://app.ihelpchat.com';

export function productActionUrl(route: string, guideId: string, target?: string): string | null;
export function productActionUrl(input: { id: string; route: string; label?: string; target?: string }): string | null;
export function productActionUrl(routeOrAction: string | { id: string; route: string; label?: string; target?: string }, guideId?: string, target?: string): string | null {
  const input = typeof routeOrAction === 'string' ? { id: guideId, route: routeOrAction, target } : routeOrAction;
  const action = resolveCatalogAction(input);
  if (!action) return null;
  const url = new URL(action.route, `${ihelpAppUrl}/`);
  url.searchParams.set('ihelpGuide', action.id);
  return url.toString();
}
