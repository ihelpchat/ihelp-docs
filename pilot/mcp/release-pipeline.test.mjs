import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
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
await writeFile(release, JSON.stringify({ ...metadata, assistantUrl: 'http://127.0.0.1:3100/assistant' }));
assert.notEqual(run(['artifact', out], { CLARICIA_DEPLOY_ENABLED: 'true' }).status, 0);
await writeFile(release, JSON.stringify(metadata));

let health = { codeSha: sha, contentSha256: contentSha };
const http = await import('node:http');
const service = http.createServer((_req, res) => res.end(JSON.stringify(health)));
service.listen(0, '127.0.0.1');
await once(service, 'listening');
const healthUrl = `http://127.0.0.1:${service.address().port}/health`;
try {
  assert.equal(run(['service', out, healthUrl]).status, 0);
  health = { ...health, contentSha256: 'c'.repeat(64) };
  assert.notEqual(run(['service', out, healthUrl]).status, 0, 'versão incompatível deve falhar');
} finally { await new Promise((resolve) => service.close(resolve)); }

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
