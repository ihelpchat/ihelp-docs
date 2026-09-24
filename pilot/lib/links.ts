export const supportUrl = 'https://wa.me/551730422307';
export const supportPhone = '(17) 3042-2307';
export const ihelpAppUrl = process.env.NEXT_PUBLIC_IHELP_APP_URL?.replace(/\/$/, '') || 'https://app.ihelpchat.com';

export function productActionUrl(route: string, guideId: string) {
  if (!/^\/(?!\/)[a-z0-9/_-]*$/.test(route)) throw new Error('Rota de ação inválida');
  const url = new URL(route, `${ihelpAppUrl}/`);
  url.searchParams.set('ihelpGuide', guideId);
  return url.toString();
}
