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
  const exclusive = (left, right) => (left.visibility ?? []).some(a =>
    (right.visibility ?? []).some(b => a.key === b.key && a.branch !== b.branch));
  // Multiple source occurrences are safe only with proof they cannot coexist.
  const coexist = matches.some((element, index) =>
    matches.slice(index + 1).some(other => !exclusive(element, other)));
  if (matches.some(element => element.duplicates > 1) || coexist) return { ok: false, reason: 'ambiguous' };
  return { ok: true, element: matches[0], locator: { kind: locator.kind, name: locator.name, ...(matches[0].inModal ? { within: 'dialog' } : {}) } };
}
