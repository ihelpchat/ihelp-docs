import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const fixture = await mkdtemp(join(tmpdir(), 'm529-release-'));
const out = join(fixture, 'out');
await mkdir(join(out, '_next/static'), { recursive: true });
const sha = 'a'.repeat(40);
const contentSha = 'b'.repeat(64);
const url = 'https://claricia.example.test/assistant';
const asset = join(out, '_next/static', 'app.js');
const release = join(out, 'release.json');
const script = join(root, 'scripts/release.mjs');
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], {
  cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
});
const metadata = { codeSha: sha, contentSha256: contentSha, assistantUrl: url };
await writeFile(release, JSON.stringify(metadata));
await writeFile(asset, 'const endpoint="";');

// A publicação habilitada exige endereço HTTPS realmente embutido no artifact.
assert.notEqual(run(['artifact', out], { CLARICIA_DEPLOY_ENABLED: 'true' }).status, 0, 'URL ausente do artifact deve falhar');
assert.notEqual(run(['artifact', out], { CLARICIA_DEPLOY_ENABLED: 'true' }).status, 0);
assert.equal(run(['artifact', out], { CLARICIA_DEPLOY_ENABLED: 'false' }).status, 0);
await writeFile(asset, `const endpoint=${JSON.stringify(url)};`);
assert.equal(run(['artifact', out], { CLARICIA_DEPLOY_ENABLED: 'true' }).status, 0);
assert.notEqual(run(['artifact', out, 'https://staging.example.test/assistant'], { CLARICIA_DEPLOY_ENABLED: 'true' }).status, 0, 'build de production com URL de staging deve falhar');
assert.equal(run(['artifact', out, url], { CLARICIA_DEPLOY_ENABLED: 'true' }).status, 0);
await writeFile(release, JSON.stringify({ ...metadata, assistantUrl: 'http://127.0.0.1:3100/assistant' }));
assert.notEqual(run(['artifact', out], { CLARICIA_DEPLOY_ENABLED: 'true' }).status, 0);
await writeFile(release, JSON.stringify(metadata));

const mock = join(fixture, 'mock-fetch.mjs');
await writeFile(mock, `globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.origin !== 'https://claricia.example.test') throw new Error('health consultou outra origem');
  if (url.pathname === '/health') return Response.json({ codeSha: '${sha}', contentSha256: process.env.MOCK_MODE === 'wrong-version' ? '${'c'.repeat(64)}' : '${contentSha}' });
  if (url.pathname !== '/assistant' || options.method !== 'OPTIONS') throw new Error('preflight ausente');
  const origin = options.headers.Origin;
  const allowed = origin === 'https://docs.example.test' || process.env.MOCK_MODE === 'bad-cors';
  return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? { 'access-control-allow-origin': origin } : {} });
};`);
const runService = (env = {}, args = ['service', out, url]) => run(args, {
  NODE_OPTIONS: `--import=${mock}`, CLARICIA_DOCS_ORIGIN: 'https://docs.example.test',
  CLARICIA_DOCS_URL: 'https://docs.example.test/ihelp-docs', ...env,
});
assert.equal(runService().status, 0);
assert.notEqual(runService({ CLARICIA_DOCS_ORIGIN: '' }).status, 0, 'origem do docs vazia deve falhar');
assert.notEqual(runService({ CLARICIA_DOCS_URL: 'https://other.example.test/ihelp-docs' }).status, 0, 'origem do smoke deve ser a do site publicado');
assert.notEqual(runService({ MOCK_MODE: 'bad-cors' }).status, 0, 'CORS aberto a outra origem deve falhar');
assert.notEqual(runService({ MOCK_MODE: 'wrong-version' }).status, 0, 'versão incompatível deve falhar');
assert.notEqual(runService({}, ['service', out, 'https://staging.example.test/assistant']).status, 0, 'health separado do artifact deve falhar');

const workflow = await readFile(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
assert.match(workflow, /CLARICIA_DEPLOY_ENABLED/);
assert.match(workflow, /NEXT_PUBLIC_ASSISTANT_URL: \$\{\{ vars\.NEXT_PUBLIC_ASSISTANT_URL \}\}/);
assert.match(workflow, /environment:/);
assert.match(workflow, /RAILWAY_TOKEN: \$\{\{ secrets\.RAILWAY_TOKEN \}\}/);
assert.match(workflow, /scripts\/release\.mjs artifact/);
assert.match(workflow, /scripts\/release\.mjs service/);
assert.match(workflow, /github\.event_name != 'pull_request'/);
assert.doesNotMatch(workflow, /railway up[\s\S]*?pull_request/);
console.log('M5.29 release pipeline: OK');
