import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseProbeTimeout } from './assistant-legibility-timeout.mjs';

const probeTimeout = parseProbeTimeout(process.env);

const probes = [
  {
    name: 'chip do artigo fora da referência do assistente',
    css: '.ih-prose a.ih-ai-product-action { font-size: 16px !important }',
    expected: /(?:desktop|mobile).*#guia-.*referência.*12px\/700/,
  },
  {
    name: 'chip do artigo sem área de toque no celular',
    css: '@media (max-width: 640px) { .ih-prose a.ih-ai-product-action { height: 20px !important; min-height: 20px !important; padding: 0 !important } }',
    expected: /mobile.*#guia-.*altura 20\.0px < 44px/,
  },
  {
    name: 'navegação desktop fora da escala de produção',
    css: '@media (min-width: 1020px) and (pointer: fine) { .ih-side-link { font-size: 16px !important } }',
    expected: /desktop.*ih-side-link.*fora da escala de produção/,
  },
  {
    name: 'texto de leitura pequeno no celular',
    css: '@media (max-width: 640px) { .ih-prose p { font-size: 12px !important } }',
    expected: /mobile.*ih-prose.*fonte 12px < 16px/,
  },
  {
    name: 'alvo de toque pequeno no celular',
    css: '@media (max-width: 640px) { .ih-ai-launcher { min-height: 20px !important; height: 20px !important; padding: 0 !important } }',
    expected: /mobile.*ih-ai-launcher.*altura 20\.0px < 44px/,
  },
  {
    name: 'texto de leitura pequeno no desktop',
    css: '@media (min-width: 1020px) { .ih-prose p { font-size: 12px !important } }',
    expected: /desktop.*ih-prose.*fonte 12px < 16px/,
  },
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
    timeout: probeTimeout,
  });
  assert.ifError(run.error);
  const output = `${run.stdout}\n${run.stderr}`;
  assert.notEqual(run.status, 0, `${probe.name}: qa:assistant aceitou a mutação`);
  assert.match(output, probe.expected, `${probe.name}: falhou por motivo diferente: ${output}`);
  console.log(`${probe.name}: mutação rejeitada pelo qa:assistant`);
}
