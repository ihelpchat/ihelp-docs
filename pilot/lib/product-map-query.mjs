// Both the persisted envelope and buildProductMap().manifest are accepted.
const manifestOf = (map) => map?.manifest ?? map;
export function elementsForRoutes(map, routes) {
  const manifest = manifestOf(map);
  const allowed = new Set((manifest?.routes ?? []).map(({ path }) => path));
  const wanted = new Set(routes.filter((route) => allowed.has(route)));
  return (manifest?.elements ?? []).filter((element) => wanted.has(element.route));
}
export function resolveLocator(map, route, locator) {
  const manifest = manifestOf(map);
  if (!(manifest?.routes ?? []).some(({ path }) => path === route)) return { ok: false, reason: 'route' };
  // Static extraction cannot prove arbitrary named containers. Fail closed.
  if (locator?.within && locator.within !== 'dialog') return { ok: false, reason: 'missing' };
  const matches = elementsForRoutes(manifest, [route]).filter((element) => element.name
    && element.kind === locator?.kind && element.name === locator?.name
    && (!locator.within || element.inModal));
  if (!matches.length) return { ok: false, reason: 'missing' };
  if (matches.length !== 1 || (!locator.within && matches[0].duplicates > 1)) return { ok: false, reason: 'ambiguous' };
  return { ok: true, element: matches[0] };
}
