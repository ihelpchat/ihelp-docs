import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [out, deployment] = process.argv.slice(2);
if (!out || !deployment) throw new Error('Uso: prepare-vercel-release.mjs <out> <deploy-dir>');
const source = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
if (source.rewrites || source.routes || source.cleanUrls) throw new Error('vercel.json contém regras não suportadas no pacote prebuilt');
const release = JSON.parse(await readFile(join(out, 'release.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/u.test(release.codeSha) || !/^[a-f0-9]{64}$/u.test(release.contentSha256)) {
  throw new Error('Artifact sem release.json válido');
}

// Build Output API serves static/ at the domain root; the exported Next.js tree keeps its basePath.
const output = join(deployment, '.vercel/output');
await mkdir(join(output, 'static/ihelp-docs'), { recursive: true });
await cp(out, join(output, 'static/ihelp-docs'), { recursive: true });
await cp(new URL('../vercel.json', import.meta.url), join(deployment, 'vercel.json'));

// --prebuilt reads config.json, not vercel.json. Mirror its redirects and headers there.
const pattern = (value) => {
  if (!/^\/[\w/.-]*(?::path\*)?\/?$/u.test(value)) throw new Error(`Rota Vercel não suportada: ${value}`);
  return `^${value.replace(':path*', '(.*)').replaceAll('.', '\\.')}$`;
};
const destination = (value) => value.replace(':path*', '$1');
const routes = [
  ...source.redirects.map(({ source: from, destination: to, permanent }) => ({
    src: pattern(from), status: permanent ? 308 : 307, headers: { Location: destination(to) },
  })),
  ...source.headers.map(({ source: from, headers }) => ({
    src: pattern(from), headers: Object.fromEntries(headers.map(({ key, value }) => [key, value])), continue: true,
  })),
  { handle: 'filesystem' },
  { src: '^/ihelp-docs/(.*)/$', dest: '/ihelp-docs/$1/index.html' },
];
await writeFile(join(output, 'config.json'), `${JSON.stringify({ version: 3, routes })}\n`);
console.log(`Vercel prebuilt pronto: ${release.codeSha} / ${release.contentSha256}`);
