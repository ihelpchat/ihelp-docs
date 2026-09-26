import allowedActions from '../architecture/product-actions.json' with { type: 'json' };
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';

export function catalogAction(id) {
  const action = typeof id === 'string' && Object.hasOwn(allowedActions, id) ? allowedActions[id] : undefined;
  return action ? { id, label: action.label, route: action.route, target: action.target } : undefined;
}

export function catalogActions() {
  return Object.keys(allowedActions).map(catalogAction);
}

export function isCatalogAction(action) {
  const canonical = resolveCatalogAction(action);
  return canonical !== null
    && Object.keys(action).length === Object.keys(canonical).length
    && Object.entries(canonical).every(([key, value]) => action[key] === value);
}
