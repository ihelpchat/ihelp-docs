import actions from './product-actions.json' with { type: 'json' };

/** Resolve somente navegação documentada; texto e alvo saem do catálogo confiável. */
export function resolveCatalogAction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !['id', 'label', 'route', 'target'].includes(key))) return null;
  const trusted = typeof input.id === 'string' && Object.hasOwn(actions, input.id) ? actions[input.id] : null;
  if (!trusted || input.route !== trusted.route) return null;
  return { id: input.id, label: trusted.label, route: trusted.route, ...(Object.hasOwn(trusted, 'target') ? { target: trusted.target } : {}) };
}
