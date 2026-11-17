import { githubRequest } from './content-service.mjs';

// Prévia do rascunho no site de staging, com o layout real: o texto vai para uma branch "rascunho/<sessão>"
// e o deploy de staging existente publica só o site (scope=site, sem republicar o serviço do MCP).
// O staging é um só: a prévia mais recente substitui a anterior, e a conferência por SHA mostra qual está no ar.

const repoOf = (env) => {
  const [owner, repo] = (env.GITHUB_REPOSITORY ?? 'ihelpchat/ihelp-docs').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY inválido');
  return `/repos/${owner}/${repo}`;
};
const siteOf = (env) => (env.AGENT_PREVIEW_SITE_URL ?? env.CLARICIA_DOCS_URL ?? '').trim().replace(/\/$/u, '');

/** Grava o rascunho na branch de prévia e dispara o deploy do site de staging. */
export async function startPreview(session, { github = githubRequest, env = process.env, now = Date.now() } = {}) {
  const { rascunho, plano } = session;
  if (!rascunho?.gates.aprovado) throw new Error('só rascunho aprovado pelos juízes vai para a prévia');
  if (!siteOf(env)) throw new Error('prévia indisponível: endereço do site de staging não configurado (AGENT_PREVIEW_SITE_URL)');
  const repo = repoOf(env);
  const base = env.GITHUB_BASE_BRANCH ?? 'main';
  const branch = `rascunho/${session.id.slice(0, 12)}`;
  const head = await github(`${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  // A branch sempre recomeça da base: a prévia mostra o site atual mais este rascunho, nada de rascunhos antigos.
  if (await github(`${repo}/git/ref/heads/${branch}`, {}, true))
    await github(`${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: head.object.sha, force: true }) });
  else await github(`${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: head.object.sha }) });
  const file = `${repo}/contents/pilot/content/docs/${plano.destino.path}.mdx`;
  const previous = await github(`${file}?ref=${encodeURIComponent(branch)}`, {}, true);
  const written = await github(file, { method: 'PUT', body: JSON.stringify({
    message: `rascunho: ${plano.destino.path}`, content: Buffer.from(rascunho.mdx).toString('base64'), branch,
    ...(previous?.sha ? { sha: previous.sha } : {}) }) });
  const commitSha = written?.commit?.sha;
  if (!/^[a-f0-9]{40}$/u.test(commitSha ?? '')) throw new Error('GitHub não devolveu o commit do rascunho');
  await github(`${repo}/actions/workflows/deploy.yml/dispatches`, { method: 'POST',
    body: JSON.stringify({ ref: branch, inputs: { target: 'staging', scope: 'site' } }) });
  return { estado: 'publicando', revisao: rascunho.revisao, branch, commitSha, iniciadaEm: new Date(now).toISOString() };
}

/** Confere se o site de staging já está servindo o commit da prévia. Só então existe previewUrl. */
export async function checkPreview(previa, path, { fetcher = fetch, env = process.env } = {}) {
  const site = siteOf(env);
  if (!site || previa.estado === 'substituida') return previa;
  let codeSha = null;
  try {
    const response = await fetcher(`${site}/release.json`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(8_000) });
    if (response.ok) codeSha = (await response.json()).codeSha ?? null;
  } catch { return previa; }
  if (codeSha === previa.commitSha) return { ...previa, estado: 'pronta', previewUrl: `${site}/${path}` };
  // Já esteve no ar e o site mudou: outra prévia ou um deploy de staging entrou por cima.
  if (previa.estado === 'pronta') return { ...previa, estado: 'substituida', previewUrl: null };
  return previa;
}
