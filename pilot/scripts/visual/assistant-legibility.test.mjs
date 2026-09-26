import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const probes = [
  {
    name: 'focus sem hover',
    css: '.ih-ai-human-action:focus { background: #fff } .ih-ai-human-action:hover { background: #c5482b }',
    expected: /ih-ai-human-action.*contraste/,
  },
  {
    name: 'placeholder branco',
    css: '.ih-ai-screen textarea::placeholder { color: #fff !important }',
    expected: /textarea.*contraste/,
  },
];

for (const probe of probes) {
  const run = spawnSync(process.execPath, ['scripts/visual/assistant-legibility.mjs'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, ASSISTANT_LEGIBILITY_PROBE_CSS: probe.css },
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.ifError(run.error);
  const output = `${run.stdout}\n${run.stderr}`;
  assert.notEqual(run.status, 0, `${probe.name}: qa:assistant aceitou a mutação`);
  assert.match(output, probe.expected, `${probe.name}: falhou por motivo diferente: ${output}`);
  console.log(`${probe.name}: mutação rejeitada pelo qa:assistant`);
}
