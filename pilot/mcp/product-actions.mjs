import allowedActions from '../architecture/product-actions.json' with { type: 'json' };

export function catalogAction(id) {
  const action = typeof id === 'string' && Object.hasOwn(allowedActions, id) ? allowedActions[id] : undefined;
  return action ? { id, label: action.label, route: action.route, target: action.target } : undefined;
}

export function isCatalogAction(action) {
  const trusted = action && catalogAction(action.id);
  return Boolean(trusted && action.label === trusted.label && action.route === trusted.route && action.target === trusted.target);
}
