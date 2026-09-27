import { readProductCheckoutState, syncProductCheckouts, restoreProductCheckouts } from './product-checkouts.mjs';
import { envCompatibility } from './env-compat.mjs';

export const codeRefreshWindowMs = 10 * 60_000;
const missingCodeReasons = [
  /^endpoint citado não encontrado\b/iu,
  /^endpoints estruturados ausentes\b/iu,
  /^código do produto indisponível\b/iu,
  /^nenhum trecho encontrado no código do produto\b/iu,
];
let refreshInProgress = false;
let lastRefreshAt = 0;

const codeMissing = (result) => {
  const reasons = [result.summary, ...(result.questions ?? []), ...(result.pending ?? []), ...(result.plan?.pending ?? [])];
  return reasons.some((reason) => typeof reason === 'string' && missingCodeReasons.some((pattern) => pattern.test(reason)));
};

export async function withCodeRefreshOffer(result, { stateDir = process.env.MCP_STATE_DIR ?? '/data', token = process.env[envCompatibility.githubReadToken.current] } = {}) {
  if (!codeMissing(result)) return result;
  let snapshot;
  try { snapshot = await readProductCheckoutState({ stateDir }); }
  catch { snapshot = {}; }
  const codeSnapshot = { front: snapshot.front ?? null, back: snapshot.back ?? null,
    updatedAt: snapshot.updatedAt ?? null, stale: !token || !snapshot.updatedAt };
  const date = snapshot.updatedAt ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(snapshot.updatedAt)) : 'data indisponível';
  const question = `Não encontrei isso no código da versão de ${date}. Quer atualizar a cópia do código e tentar de novo? Use a ferramenta atualizar_codigo_produto.`;
  return { ...result, questions: [...new Set([...(result.questions ?? []), question])], codeSnapshot };
}

export async function refreshCodeProduct({ stateDir = process.env.MCP_STATE_DIR ?? '/data', token = process.env[envCompatibility.githubReadToken.current],
  now = Date.now, sync = syncProductCheckouts, ...syncOptions } = {}) {
  if (!token) return { reason: 'GITHUB_READ_TOKEN ausente' };
  if (refreshInProgress) return { reason: 'atualização em andamento' };
  const instant = new Date(now()).getTime();
  const remaining = codeRefreshWindowMs - (instant - lastRefreshAt);
  if (lastRefreshAt && remaining > 0) return { reason: `aguarde ${Math.ceil(remaining / 60_000)} minutos` };
  refreshInProgress = true;
  try {
    const previous = await readProductCheckoutState({ stateDir }).catch(() => null);
    const current = await sync({ stateDir, token, now: () => new Date(instant), ...syncOptions });
    await restoreProductCheckouts(stateDir);
    lastRefreshAt = instant;
    if (previous?.front?.sha === current.front.sha && previous?.back?.sha === current.back.sha) return { status: 'sem mudança' };
    return { status: 'atualizado', front: current.front, back: current.back, updatedAt: current.updatedAt };
  } finally { refreshInProgress = false; }
}
