import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseProbeTimeout } from './assistant-legibility-timeout.mjs';

const mutations = [
  ['título longo', { ASSISTANT_LEGIBILITY_PROBE_TITLE: '1' }, /título da tela cheia fora da produção/],
  ['sugestão de 16px', { ASSISTANT_LEGIBILITY_PROBE_CSS: '.ih-ai-drawer-empty button { font-size: 16px !important }' }, /ih-ai-drawer-empty button.*referência 13px/],
  ['botão humano grande', { ASSISTANT_LEGIBILITY_PROBE_HUMAN: '1' }, /link humano discreto no rodapé/],
  ['rodapé móvel estreito', { ASSISTANT_LEGIBILITY_PROBE_CSS: '@media (max-width: 640px) { .ih-ai-drawer-meta { display: flex !important } }' }, /rodapé móvel: aviso em [34] linhas/],
  ['ocupado com 16px', { ASSISTANT_LEGIBILITY_PROBE_CSS: '.ih-ai-busy-label { font-size: 16px !important }' }, /ih-ai-busy-label.*referência 13px/],
];

for (const [name, env, expected] of mutations) {
  const run = spawnSync(process.execPath, ['scripts/visual/assistant-legibility.mjs'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: parseProbeTimeout(process.env),
  });
  assert.ifError(run.error);
  const output = `${run.stdout}\n${run.stderr}`;
  assert.notEqual(run.status, 0, `${name}: gate aceitou a mutação`);
  assert.match(output, expected, `${name}: falhou por outro motivo: ${output}`);
  console.log(`${name}: RED por asserção`);
}
