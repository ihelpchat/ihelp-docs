import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const checker = new URL('../scripts/workflow-concurrency.check.mjs', import.meta.url).pathname;
const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../../.github/workflows/product-release.yml', import.meta.url), 'utf8');
const temp = mkdtempSync(join(tmpdir(), 'published-build-'));
try {
  const safe = join(temp, 'safe.yml');
  writeFileSync(safe, workflow);
  assert.equal(spawnSync(process.execPath, [checker, safe], { encoding: 'utf8' }).status, 0, 'workflow seguro passa');
  const unsafe = join(temp, 'unsafe.yml');
  writeFileSync(unsafe, readFileSync(safe, 'utf8').replace(
    '          NEXT_PUBLIC_BASE_PATH: /ihelp-docs',
    '          NEXT_PUBLIC_BASE_PATH: /ihelp-docs\n          NEXT_PUBLIC_ASSISTANT_URL: http://127.0.0.1:3100/assistant',
  ));
  const result = spawnSync(process.execPath, [checker, unsafe], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'recolocar URL local no Build website deve quebrar o check');
  assert.match(result.stderr, /NEXT_PUBLIC_ASSISTANT_URL|local/i);
  const mutations = [
    ['PR com pages:write', (s) => s.replace('  contents: read', '  contents: read\n  pages: write')],
    ['checkout persistente', (s) => s.replace('          persist-credentials: false', '          persist-credentials: true')],
    ['build de production com staging URL', (s) => s.replace('NEXT_PUBLIC_ASSISTANT_URL: ${{ vars.NEXT_PUBLIC_ASSISTANT_URL }}', 'NEXT_PUBLIC_ASSISTANT_URL: ${{ vars.STAGING_ASSISTANT_URL }}')],
  ];
  for (const [label, mutate] of mutations) {
    const bad = join(temp, `${label.replaceAll(' ', '-')}.yml`);
    const changed = mutate(workflow);
    assert.notEqual(changed, workflow, `${label}: fixture não mudou`);
    writeFileSync(bad, changed);
    assert.notEqual(spawnSync(process.execPath, [checker, bad], { encoding: 'utf8' }).status, 0, label);
  }
  const releaseFile = join(temp, 'release.yml');
  const checkRelease = (source) => {
    writeFileSync(releaseFile, source);
    return spawnSync(process.execPath, [checker, '--product-release', releaseFile], { encoding: 'utf8' });
  };
  assert.equal(checkRelease(release).status, 0, 'workflow de versão seguro passa');
  const releaseMutations = [
    ['pull_request', (s) => s.replace('  workflow_dispatch:', '  pull_request:\n  workflow_dispatch:'), /schedule.*workflow_dispatch|pull_request/i],
    ['GITHUB_TOKEN para escrita', (s) => s.replace('GITHUB_TOKEN: ${{ secrets.DOCS_WRITE_TOKEN }}', 'GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}'), /DOCS_WRITE_TOKEN/i],
    ['base main', (s) => s.replace('DOCS_UPDATE_BASE: ${{ vars.DOCS_UPDATE_BASE }}', 'DOCS_UPDATE_BASE: main'), /DOCS_UPDATE_BASE/i],
    ['token de leitura fora do checkout', (s) => s.replace('          PRODUCT_READ_TOKEN: ${{ secrets.PRODUCT_READ_TOKEN }}', '          PRODUCT_READ_TOKEN: ${{ secrets.PRODUCT_READ_TOKEN }}\n          EXTRA_READ_TOKEN: ${{ secrets.PRODUCT_READ_TOKEN }}'), /PRODUCT_READ_TOKEN/i],
  ];
  for (const [label, mutate, reason] of releaseMutations) {
    const changed = mutate(release);
    assert.notEqual(changed, release, `${label}: fixture não mudou`);
    const verdict = checkRelease(changed);
    assert.notEqual(verdict.status, 0, label);
    assert.match(verdict.stderr, reason, `${label}: motivo específico`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
