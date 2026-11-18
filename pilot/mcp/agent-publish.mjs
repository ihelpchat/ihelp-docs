import { createHash } from 'node:crypto';
import { githubRequest } from './content-service.mjs';
import { repoOf } from './agent-preview.mjs';

// Publicação do rascunho aprovado: PR na branch base, merge e deploy só do site de produção (scope=site).
// O deploy roda no environment "production" do GitHub, que pede a aprovação de um revisor antes de ir ao ar.
// "publicado" só existe depois de conferir que o site de produção serve um commit que contém o merge.

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const siteOf = (env) => (env.AGENT_PUBLISH_SITE_URL ?? '').trim().replace(/\/$/u, '');
const dispatch = (github, repo, base) => github(`${repo}/actions/workflows/deploy.yml/dispatches`, { method: 'POST',
  body: JSON.stringify({ ref: base, inputs: { target: 'production', scope: 'site' } }) });

/** Hash do texto da página de destino quando o rascunho foi escrito; null para página nova. */
export const baseHash = (raw) => raw == null ? null : sha256(raw);

/** Abre a PR com o rascunho, faz o merge na branch base e dispara o deploy do site de produção. */
export async function startPublish(session, { github = githubRequest, env = process.env, now = Date.now() } = {}) {
  const { rascunho, plano } = session;
  if (!rascunho?.gates.aprovado) throw new Error('só rascunho aprovado pelos juízes pode ser publicado');
  if (rascunho.pendencias.length) throw new Error(`há ${rascunho.pendencias.length} frase(s) a confirmar; produção só aceita texto sem pendência. Confirme ou retire por faq_responder`);
  if (!siteOf(env)) throw new Error('publicação indisponível: endereço do site de produção não configurado (AGENT_PUBLISH_SITE_URL)');
  const repo = repoOf(env);
  const base = env.GITHUB_BASE_BRANCH ?? 'main';
  const branch = `publicar/${session.id.slice(0, 12)}`;
  const path = `pilot/content/docs/${plano.destino.path}.mdx`;
  const head = await github(`${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  // O rascunho foi encaixado no texto que o serviço tinha. Se a página mudou na base desde então, publicar apagaria a mudança.
  const current = await github(`${repo}/contents/${path}?ref=${encodeURIComponent(base)}`, {}, true);
  const currentHash = current ? sha256(Buffer.from(current.content, 'base64').toString('utf8')) : null;
  if (currentHash !== (rascunho.baseSha256 ?? null))
    throw new Error('a página de destino mudou desde que o rascunho foi escrito; mande uma sugestão por faq_responder para o agente reescrever sobre o texto atual');
  if (await github(`${repo}/git/ref/heads/${branch}`, {}, true))
    await github(`${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: head.object.sha, force: true }) });
  else await github(`${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: head.object.sha }) });
  // Mesma marca que docs_submit grava: a partir deste commit, mudança na página é edição humana.
  const mdx = rascunho.mdx.replace(/^mcpGeneratedSha:.*$/mu, `mcpGeneratedSha: ${head.object.sha}`);
  await github(`${repo}/contents/${path}`, { method: 'PUT', body: JSON.stringify({
    message: `docs: ${plano.destino.path}`, content: Buffer.from(mdx).toString('base64'), branch,
    ...(current?.sha ? { sha: current.sha } : {}) }) });
  const [owner] = repo.split('/').slice(2);
  const open = await github(`${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}&base=${encodeURIComponent(base)}`);
  const pull = open?.[0] ?? await github(`${repo}/pulls`, { method: 'POST', body: JSON.stringify({ head: branch, base,
    title: `docs: ${plano.destino.path}`,
    body: `Conteúdo escrito pelo agente de FAQ do MCP e aprovado pelos juízes de fatos, editorial e segurança.\n\nAudit MCP: actor=${session.criadaPor}; at=${new Date(now).toISOString()}; operation=faq_publicar; revisao=${rascunho.revisao}` }) });
  const merged = await github(`${repo}/pulls/${pull.number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: 'squash' }) });
  if (!/^[a-f0-9]{40}$/u.test(merged?.sha ?? '')) throw new Error('GitHub não confirmou o merge da publicação');
  await github(`${repo}/git/refs/heads/${branch}`, { method: 'DELETE' }, true);
  await dispatch(github, repo, base);
  return { etapa: 'deploy', revisao: rascunho.revisao, pr: pull.html_url, mergeSha: merged.sha, iniciadaEm: new Date(now).toISOString(), url: null };
}

/** Dispara de novo só o deploy (o merge já está na base). Para deploy que falhou ou foi recusado. */
export async function redeployPublish(publicacao, { github = githubRequest, env = process.env, now = Date.now() } = {}) {
  await dispatch(github, repoOf(env), env.GITHUB_BASE_BRANCH ?? 'main');
  return { ...publicacao, iniciadaEm: new Date(now).toISOString() };
}

/** Confere se o site de produção já serve um commit que contém o merge. Só então a sessão vira "publicado". */
export async function checkPublish(publicacao, path, { fetcher = fetch, github = githubRequest, env = process.env } = {}) {
  const site = siteOf(env);
  if (!site || publicacao.etapa === 'publicado') return publicacao;
  let codeSha = null;
  try {
    const response = await fetcher(`${site}/release.json`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8_000) });
    if (response.ok) codeSha = (await response.json()).codeSha ?? null;
  } catch { return publicacao; }
  if (!/^[a-f0-9]{40}$/u.test(codeSha ?? '')) return publicacao;
  let contains = codeSha === publicacao.mergeSha;
  if (!contains) {
    // Outro merge pode ter entrado depois: vale se o commit no ar descende do merge desta publicação.
    const compared = await github(`${repoOf(env)}/compare/${publicacao.mergeSha}...${codeSha}`, {}, true).catch(() => null);
    contains = ['ahead', 'identical'].includes(compared?.status);
  }
  return contains ? { ...publicacao, etapa: 'publicado', url: `${site}/${path}/` } : publicacao;
}
