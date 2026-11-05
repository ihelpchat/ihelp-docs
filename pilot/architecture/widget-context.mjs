import actions from './product-actions.json' with { type: 'json' };

// Keep legacy routes for old clients while the application moves to the new settings shell.
export const widgetContextRoutes = [...new Set([
  ...Object.values(actions).map(({ route }) => route),
  ...['canais', 'usuarios', 'departamentos', 'mensagens', 'horarios', 'primeiros-passos', 'perfis'].map((slug) => `/configuracoes/${slug}`),
  '/atendimento/mobile', '/tarefas',
])];
export const widgetPermissions = [
  'robots.read', 'robots.create', 'users.read', 'users.manage', 'channels.read', 'channels.manage',
  'billing.read', 'campaigns.read', 'campaigns.create', 'templates.read', 'templates.manage',
  'conversations.read', 'groups.read', 'groups.manage', 'settings.manage', 'departments.manage',
  'tasks.read', 'contacts.read', 'crm.read',
];
// A single given name, including composed Unicode letters and hyphen/apostrophe names.
export const actorFirstNamePattern = /^\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*$/u;
export const actorIdRefPattern = /^(?!(?:sk[-_]|gh[pousr]_|github_pat_|AIza))(?=.*[A-Za-z])[A-Za-z0-9_-]{3,128}$/u;
