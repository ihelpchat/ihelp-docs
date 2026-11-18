import navigation from './navigation-routes.front.json' with { type: 'json' };

// Canonical routes and explicit legacy aliases share the app-generated catalog.
export const widgetContextRoutes = Object.freeze([...new Set([
  ...navigation.catalog.routePaths,
  ...navigation.catalog.routes.map(({ path }) => path),
])]);
export const widgetPermissions = [
  'robots.read', 'robots.create', 'users.read', 'users.manage', 'channels.read', 'channels.manage',
  'billing.read', 'campaigns.read', 'campaigns.create', 'templates.read', 'templates.manage',
  'conversations.read', 'groups.read', 'groups.send', 'groups.manage', 'settings.manage', 'departments.manage',
  'tasks.read', 'contacts.read', 'crm.read',
];
// A single given name, including composed Unicode letters and hyphen/apostrophe names.
export const actorFirstNamePattern = /^\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*$/u;
export const actorIdRefPattern = /^(?!(?:sk[-_]|gh[pousr]_|github_pat_|AIza))(?=.*[A-Za-z])[A-Za-z0-9_-]{3,128}$/u;
