import { readdirSync } from 'node:fs';

// Exibição do widget do app: decisão de configuração do serviço.
// Não chama provider de IA, não lê conversa e não autoriza tenant nem operação.
export const widgetConfigEnv = Object.freeze({
  enabled: 'ASSISTANT_WIDGET_ENABLED',
  companyIds: 'ASSISTANT_WIDGET_COMPANY_IDS',
  pilotGuides: 'ASSISTANT_WIDGET_PILOT_GUIDES',
  pilotCompanyIds: 'ASSISTANT_WIDGET_PILOT_COMPANY_IDS',
});

const companyIdPattern = /^[1-9]\d{0,14}$/u;

/** Roteiros de piloto existentes: os drafts source-only, ainda sem aprovação editorial. */
export const pilotGuideIds = Object.freeze(
  readdirSync(new URL('../architecture/widget-guides-drafts/', import.meta.url))
    .filter((name) => /^[a-z0-9-]+\.json$/u.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort(),
);

const items = (value) => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

function companySet(name, env, warn) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return null;
  const ids = new Set();
  for (const item of items(raw)) {
    if (companyIdPattern.test(item)) ids.add(Number(item));
    else warn(`${name}: valor ignorado; use IDs numéricos de empresa separados por vírgula.`);
  }
  // Variável presente nunca vira "todas as empresas", mesmo que nenhum ID seja válido.
  return ids;
}

/**
 * Padrão fechado: sem `ASSISTANT_WIDGET_ENABLED=true` o widget fica oculto.
 * Valor inválido não derruba o serviço (o FAQ depende do mesmo processo); só mantém o widget oculto.
 */
export function widgetConfigFromEnv(env = process.env, warn = console.error) {
  const rawEnabled = env[widgetConfigEnv.enabled]?.trim().toLowerCase();
  if (rawEnabled && !['true', 'false', '1', '0'].includes(rawEnabled)) {
    warn(`${widgetConfigEnv.enabled} inválido: use true ou false. O widget permanece oculto.`);
  }
  const pilotCompanyIds = companySet(widgetConfigEnv.pilotCompanyIds, env, warn) ?? new Set();
  const pilotGuides = [...new Set(items(env[widgetConfigEnv.pilotGuides]))].filter((id) => {
    if (pilotGuideIds.includes(id)) return true;
    warn(`${widgetConfigEnv.pilotGuides}: roteiro desconhecido ignorado.`);
    return false;
  });
  if (pilotGuides.length && !pilotCompanyIds.size) {
    warn(`${widgetConfigEnv.pilotGuides} sem ${widgetConfigEnv.pilotCompanyIds}: roteiros de piloto não são oferecidos a ninguém.`);
  }
  return Object.freeze({
    enabled: rawEnabled === 'true' || rawEnabled === '1',
    companyIds: companySet(widgetConfigEnv.companyIds, env, warn),
    pilotGuides: Object.freeze(pilotGuides),
    pilotCompanyIds,
  });
}

/**
 * Resposta pública. As listas de empresas ficam no servidor; o cliente só recebe a própria decisão.
 * Roteiros de piloto exigem lista explícita de empresas: configuração nenhuma os libera para todos.
 */
export function widgetConfigFor(config, companyId) {
  const known = Number.isSafeInteger(companyId) && companyId > 0;
  const enabled = config.enabled && (config.companyIds === null || (known && config.companyIds.has(companyId)));
  const pilotGuides = enabled && known && config.pilotCompanyIds.has(companyId) ? [...config.pilotGuides] : [];
  return { schemaVersion: 1, widget: { enabled, pilotGuides } };
}

/** `company` é opcional; quando presente, precisa ser um único inteiro positivo. */
export function companyFromQuery(searchParams) {
  const values = searchParams.getAll('company');
  if (values.length === 0) return { ok: true };
  if (values.length !== 1 || !companyIdPattern.test(values[0])) return { ok: false };
  return { ok: true, companyId: Number(values[0]) };
}
