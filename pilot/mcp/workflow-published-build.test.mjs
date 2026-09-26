import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const checker = new URL('../scripts/workflow-concurrency.check.mjs', import.meta.url).pathname;
const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
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
} finally {
  rmSync(temp, { recursive: true, force: true });
}
