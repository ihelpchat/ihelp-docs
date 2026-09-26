import { loadCredentials, loadLegacyCredential } from './access-control.mjs';

// Single authority for environment names changed or split by M5.14.
export const envCompatibility = Object.freeze({
  mcpCredentials: Object.freeze({ old: 'DOCS_MCP_API_KEY', current: 'DOCS_MCP_CREDENTIALS', rule: 'old used only when current is absent' }),
  githubReadToken: Object.freeze({ old: 'GITHUB_TOKEN', current: 'GITHUB_READ_TOKEN', rule: 'old used only when current is absent' }),
  guideProof: Object.freeze({ stagingUrl: 'GUIDE_QA_STAGING_URL', allowedHosts: 'GUIDE_QA_ALLOWED_HOSTS', authorizedEmail: 'GUIDE_QA_AUTHORIZED_EMAIL', authorizedPassword: 'GUIDE_QA_AUTHORIZED_PASSWORD', deniedEmail: 'GUIDE_QA_DENIED_EMAIL', deniedPassword: 'GUIDE_QA_DENIED_PASSWORD', appSha: 'GUIDE_QA_APP_SHA' }),
});

const warned = new Set();
function warnOnce(name, message) {
  if (warned.has(name)) return;
  warned.add(name);
  console.error(message);
}

export function mcpCredentialsFromEnv(env = process.env) {
  const { old, current } = envCompatibility.mcpCredentials;
  if (env[current]) {
    if (env[old]) warnOnce(old, `${old} ignorada: ${current} está configurado.`);
    return loadCredentials(env[current]);
  }
  if (env[old]) {
    warnOnce(old, `${old} descontinuada: migre para ${current}.`);
    return [loadLegacyCredential(env[old])];
  }
  return [];
}

export function githubReadToken(env = process.env) {
  const { old, current } = envCompatibility.githubReadToken;
  if (env[current]) return env[current];
  if (env[old]) {
    warnOnce(old, `${old} usada para leitura privada por compatibilidade; configure ${current} com acesso somente de leitura.`);
    return env[old];
  }
  return undefined;
}

export function githubWriteToken(env = process.env) {
  return env[envCompatibility.githubReadToken.old];
}
