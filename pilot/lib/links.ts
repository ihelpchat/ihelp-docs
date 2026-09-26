import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import type { AssistantReply } from './assistant';

export const supportUrl = 'https://wa.me/551730422307';
export const supportPhone = '(17) 3042-2307';
export type SupportGuide = { guideId: string; stepId: string };

export function supportGuideFromReply(reply?: AssistantReply): SupportGuide | undefined {
  const guideId = reply?.escalation?.guideId ?? reply?.guide?.guideId;
  const stepId = reply?.escalation?.stepId ?? reply?.guide?.stepId;
  return guideId && stepId ? { guideId, stepId } : undefined;
}

export function supportGuideFromPage(): SupportGuide | undefined {
  if (typeof document === 'undefined') return undefined;
  const guide = document.querySelector<HTMLElement>('[data-guide-id][data-step-id]');
  const params = new URLSearchParams(window.location.search);
  const guideId = guide?.dataset.guideId ?? params.get('guideId');
  const stepId = guide?.dataset.stepId ?? params.get('stepId');
  return guideId && stepId ? { guideId, stepId } : undefined;
}

export function supportLink({ guide, message }: { guide?: SupportGuide; message?: string } = {}): string {
  const context = guide;
  const body = message ?? 'Olá! Preciso de ajuda no iHelp.';
  const line = context ? `Guia: ${context.guideId}; passo: ${context.stepId}.` : '';
  const text = line && !body.includes(line) ? `${body}\n${line}` : body;
  return `${supportUrl}?text=${encodeURIComponent(text)}`;
}
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
