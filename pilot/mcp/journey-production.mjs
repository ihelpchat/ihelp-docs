const unavailable = 'não verificável';
const identifier = /^[a-z0-9-]{1,80}$/iu;
const hostname = /^[a-z0-9.-]+$/u;
const acceptedItems = new Set(['contacts', 'channels', 'automations', 'integrations']);

export function journeyTarget(env = process.env) {
  const mode = env.QA_TARGET ?? 'homolog';
  if (mode !== 'homolog' && mode !== 'producao') throw new Error('QA_TARGET inválido');
  if (mode === 'homolog') return { mode, url: env.GUIDE_QA_STAGING_URL };
  return productionConfig(env);
}

export function productionConfig(env = process.env) {
  if (env.QA_TARGET !== 'producao' || env.QA_PROD_ENABLED !== 'true')
    throw new Error('produção desabilitada');
  let url;
  try { url = new URL(env.QA_PROD_URL); } catch { throw new Error('URL de produção inválida'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash
    || url.pathname !== '/') throw new Error('URL de produção inválida');
  const hosts = String(env.QA_PROD_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim());
  if (hosts.length < 1 || hosts.length > 2 || hosts.some((host) => !hostname.test(host) || host !== host.toLowerCase())
    || new Set(hosts).size !== hosts.length || !hosts.includes(url.hostname)
    || hosts.some((host) => host !== url.hostname && !/^api(?:v\d+)?[.-]/u.test(host)))
    throw new Error('hosts de produção inválidos');
  if (!env.QA_PROD_EMAIL || !env.QA_PROD_PASSWORD) throw new Error('credencial de produção ausente');
  const accepted = String(env.QA_PROD_ACCEPT_UNVERIFIABLE ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  if (accepted.some((item) => !acceptedItems.has(item)) || new Set(accepted).size !== accepted.length)
    throw new Error('aceite de pré-voo inválido');
  const companyId = env.QA_PROD_COMPANY_ID;
  if (companyId && !identifier.test(companyId)) throw new Error('ID de empresa inválido');
  return { mode: 'producao', url: url.origin, companyId,
    target: { url: url.origin, local: false, mode: 'producao', allowedHosts: hosts }, accepted };
}

const rows = (body) => Array.isArray(body) ? body : Array.isArray(body?.dados) ? body.dados : null;
const count = (body) => Number.isSafeInteger(body?.count) && body.count >= 0 ? body.count : unavailable;
const active = (body) => {
  const list = rows(body);
  if (!list || list.some((item) => typeof item?.status !== 'boolean')) return unavailable;
  return list.filter((item) => item.status).length;
};
const resultOf = async (get, path) => { try { return await get(path); } catch { return null; } };

export async function productionPreflight({ env = process.env, identity, get }) {
  const config = productionConfig(env);
  if (typeof get !== 'function' || !identifier.test(identity?.companyId ?? ''))
    throw new Error('identidade autenticada indisponível');
  const company = (await resultOf(get, '/company'))?.dados;
  const companyId = String(company?.id ?? '');
  if (!identifier.test(companyId) || companyId !== identity.companyId)
    throw new Error('empresa divergente da sessão');
  const companyName = typeof company.nome === 'string' && company.nome.trim()
    ? company.nome.trim().slice(0, 120) : unavailable;
  if (config.companyId && config.companyId !== companyId) throw new Error('empresa divergente da configuração');
  const [contacts, channelBody, bots, integrations] = await Promise.all([
    resultOf(get, '/contacts?page=1&limit=1'), resultOf(get, '/configurations/channels'),
    resultOf(get, '/bot'), resultOf(get, '/webhook'),
  ]);
  const channels = rows(channelBody);
  let connectedChannels = unavailable;
  if (channels && channels.length <= 5000 && channels.every((channel) =>
    typeof channel?.idRef === 'string' && identifier.test(channel.idRef))) {
    const states = await Promise.all(channels.map((channel) =>
      resultOf(get, `/channel/connect-status/${channel.idRef}`)));
    if (states.every((state) => typeof state?.dados?.connected === 'boolean'))
      connectedChannels = states.filter((state) => state.dados.connected).length;
  }
  const counts = { contacts: count(contacts), channels: channels?.length ?? unavailable,
    connectedChannels, activeAutomations: active(bots), activeIntegrations: active(integrations) };
  if (!config.companyId) return { mode: 'confirmacao', companyId, companyName, counts };
  const checks = { contacts: counts.contacts, channels: counts.connectedChannels,
    automations: counts.activeAutomations, integrations: counts.activeIntegrations };
  const unsafe = companyName === unavailable || Object.entries(checks).some(([item, value]) =>
    typeof value === 'number' && item !== 'contacts' && value > 0
      || value === unavailable && !config.accepted.includes(item));
  return unsafe ? { mode: 'bloqueado', counts }
    : { mode: 'ready', companyId, companyName, counts };
}
