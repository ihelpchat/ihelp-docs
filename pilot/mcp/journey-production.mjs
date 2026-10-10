const unavailable = 'não verificável';
const identifier = /^[a-z0-9-]{1,80}$/iu;
const hostname = /^[a-z0-9.-]+$/u;

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
  const companyId = env.QA_PROD_COMPANY_ID;
  if (companyId && !identifier.test(companyId)) throw new Error('ID de empresa inválido');
  return { mode: 'producao', url: url.origin, companyId,
    target: { url: url.origin, local: false, mode: 'producao', allowedHosts: hosts } };
}

const rows = (body) => Array.isArray(body) ? body : Array.isArray(body?.dados) ? body.dados : null;
const count = (body) => Number.isSafeInteger(body?.count) && body.count >= 0 ? body.count : unavailable;
const active = (body, field) => {
  const list = rows(body);
  if (!list || list.some((item) => typeof item?.[field] !== 'boolean')) return unavailable;
  return list.filter((item) => item[field]).length;
};
const resultOf = async (get, path) => { try { return await get(path); } catch { return null; } };
const ownerAttestationDate = (raw, channels) => {
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'channelIds,date'
    || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value.date)
    || !Array.isArray(value.channelIds) || value.channelIds.some((id) => typeof id !== 'string' || !identifier.test(id)))
    return null;
  const date = Date.parse(`${value.date}T00:00:00.000Z`);
  const ageDays = (Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z') - date) / 86400_000;
  const actual = new Set(channels.map((channel) => channel.idRef));
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value.date
    || ageDays < 0 || ageDays > 7 || actual.size !== channels.length
    || value.channelIds.length !== actual.size || new Set(value.channelIds).size !== actual.size
    || value.channelIds.some((id) => !actual.has(id))) return null;
  return value.date;
};

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
  const [contacts, channelBody, bots, automations, integrations] = await Promise.all([
    resultOf(get, '/contacts?page=1&limit=1'), resultOf(get, '/configurations/channels'),
    resultOf(get, '/bot'), resultOf(get, '/automation'), resultOf(get, '/webhook'),
  ]);
  const channels = rows(channelBody);
  let connectedChannels = unavailable;
  let channelReason = 'estado dos canais não verificável';
  let connectivityAttestation;
  if (channels && channels.length <= 5000 && channels.every((channel) =>
    typeof channel?.idRef === 'string' && identifier.test(channel.idRef)
      && typeof channel.connected === 'boolean')) {
    const states = await Promise.all(channels.map((channel) =>
      resultOf(get, `/channel/connect-status/${channel.idRef}`)));
    if (states.every((state) => typeof state?.dados?.connected === 'boolean')) {
      if (states.some((state, index) => state.dados.connected !== channels[index].connected))
        channelReason = 'estado dos canais divergente';
      else {
        const connected = channels.filter((channel) => channel.connected).length;
        if (connected > 0) { connectedChannels = connected; channelReason = 'canais conectados'; }
        else {
          const date = ownerAttestationDate(env.QA_PROD_OWNER_ATTESTATION, channels);
          if (date) {
            connectedChannels = 0;
            channelReason = null;
            connectivityAttestation = `conectividade atestada pelo dono em ${date}`;
          } else channelReason = 'conectividade não atestada pelo dono';
        }
      }
    }
  }
  const activeBots = active(bots, 'status');
  const activeRules = active(automations, 'isActive');
  const counts = { contacts: count(contacts), channels: channels?.length ?? unavailable,
    connectedChannels, activeAutomations: typeof activeBots === 'number' && typeof activeRules === 'number'
      ? activeBots + activeRules : unavailable, activeIntegrations: active(integrations, 'status') };
  if (!config.companyId) return { mode: 'confirmacao', companyId, companyName, counts };
  const checks = { contacts: counts.contacts, channels: counts.connectedChannels,
    automations: counts.activeAutomations, integrations: counts.activeIntegrations };
  const unsafe = companyName === unavailable || Object.entries(checks).some(([item, value]) =>
    typeof value === 'number' && item !== 'contacts' && value > 0 || value === unavailable);
  return unsafe ? { mode: 'bloqueado', reason: channelReason ?? 'pré-voo não comprovado', counts }
    : { mode: 'ready', companyId, companyName, counts, connectivityAttestation };
}
