import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const enabled = process.env.CLARICIA_DEPLOY_ENABLED === 'true';
const command = process.argv[2];
const requireHttps = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/assistant') {
    throw new Error('NEXT_PUBLIC_ASSISTANT_URL deve ser HTTPS e terminar em /assistant');
  }
  return url.href;
};
const parse = async (file) => JSON.parse(await readFile(file, 'utf8'));
const validSha = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value);

async function prepare() {
  const assistantUrl = process.env.NEXT_PUBLIC_ASSISTANT_URL?.trim() ?? '';
  if (enabled && !assistantUrl) throw new Error('Publicação ativada sem NEXT_PUBLIC_ASSISTANT_URL');
  if (assistantUrl) requireHttps(assistantUrl);
  const codeSha = process.env.GITHUB_SHA;
  if (!validSha(codeSha, 40)) throw new Error('GITHUB_SHA inválido');
  const manifest = await parse(join(root, 'public/guides/manifest.json'));
  const catalog = await parse(join(root, 'public/guides', manifest.current, 'catalog.json'));
  if (!validSha(catalog.contentSha256, 64) || manifest.current !== catalog.contentSha256.slice(0, 12)) throw new Error('Pacote de conteúdo inválido');
  await writeFile(join(root, 'public/release.json'), `${JSON.stringify({ codeSha, contentSha256: catalog.contentSha256, assistantUrl })}\n`);
  console.log(`Release ${codeSha} conteúdo ${catalog.contentSha256}`);
}

async function containsUrl(dir, url) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (await containsUrl(path, url)) return true; }
    else if (entry.isFile() && /\.(?:html|js)$/u.test(entry.name) && (await readFile(path, 'utf8')).includes(url)) return true;
  }
  return false;
}

async function artifact(out) {
  const release = await parse(join(out, 'release.json'));
  if (!validSha(release.codeSha, 40) || !validSha(release.contentSha256, 64)) throw new Error('Release sem SHAs válidos');
  if (!enabled) { console.log('pendente: deploy da Claricia desativado (CLARICIA_DEPLOY_ENABLED)'); return; }
  const url = requireHttps(release.assistantUrl);
  if (!await containsUrl(out, url)) throw new Error('Artifact publicado sem endereço da Claricia');
  console.log(`Artifact contém ${url}`);
}

async function site(out, siteUrl) {
  const expected = await parse(join(out, 'release.json'));
  const url = new URL('ihelp-docs/release.json', `${siteUrl.replace(/\/$/u, '')}/`);
  if (url.protocol !== 'https:') throw new Error('Staging docs URL deve ser HTTPS');
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`Staging docs HTTP ${response.status}`);
  const actual = await response.json();
  if (actual.codeSha !== expected.codeSha || actual.contentSha256 !== expected.contentSha256) throw new Error('Staging docs não publicou SHA esperado');
  console.log(`Staging docs SHA ${actual.codeSha} / ${actual.contentSha256}`);
}

async function service(out, healthUrl) {
  const release = await parse(join(out, 'release.json'));
  const url = new URL(healthUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/health') throw new Error('Health URL inválida');
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Health HTTP ${response.status}`);
  const origin = process.env.CLARICIA_DOCS_ORIGIN;
  if (origin) {
    const preflight = await fetch(new URL('/assistant', url), {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      signal: AbortSignal.timeout(10_000),
    });
    if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== origin) {
      throw new Error('CORS da Claricia incompatível com docs');
    }
  }
  const health = await response.json();
  if (health.codeSha !== release.codeSha || health.contentSha256 !== release.contentSha256) {
    throw new Error('Serviço e conteúdo incompatíveis com build do docs');
  }
  console.log(`Health compatível: ${health.codeSha} / ${health.contentSha256}`);
}

try {
  if (command === 'prepare') await prepare();
  else if (command === 'artifact') await artifact(process.argv[3]);
  else if (command === 'site') await site(process.argv[3], process.argv[4]);
  else if (command === 'service') await service(process.argv[3], process.argv[4]);
  else throw new Error('Uso: release.mjs prepare | artifact <out> | site <out> <url> | service <out> <health-url>');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
