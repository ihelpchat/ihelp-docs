import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { sensitiveKinds } from './sensitive-data.mjs';

const root = await mkdtemp(join(tmpdir(), 'm5-19-gate-'));
const dir = join(root, 'content/docs');
await mkdir(dir, { recursive: true });
const file = join(dir, 'guia.mdx');
const guide = {
  schemaVersion: 1, guideId: 'reconectar-canal-qr', version: 1, mode: 'real', initialStepId: 'inicio',
  steps: [{ stepId: 'inicio', text: 'Abra a tela Canais.', choices: [{ id: 'achei', label: 'Achei' }] }],
};
const base = { title: 'Guia público', description: 'Abra Canais com segurança.', source: 'produto', contentType: 'guia', guide };
const body = 'Orientação pública de exemplo. '.repeat(65);
const compile = async (metadata) => {
  await writeFile(file, `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n${body}`);
  return compileGuidePackage(root);
};

await compile(base);
for (const [field, value] of [
  ['title', 'Acesse /admin/operacoes'],
  ['description', 'Acesse /configuracoes/channel%2f..%2fadmin'],
  ['title', 'Guia ІNTERNO'],
  ['description', 'Guia com а cirílico'],
  ['title', 'Guia com α grego'],
  ['title', 'Guia\u200binvisível'],
  ['title', 'Guia\u00adoculto'],
]) {
  await assert.rejects(compile({ ...base, [field]: value }), /rota|caractere|interno|privado|U\+[0-9A-F]{4,6}/iu, `${field}: ${value}`);
}
for (const value of ['Acesse /configuracoes/channel%2f..%2fadmin', 'Acesse /configuracoes/channel/subrota', 'Acesse /admin/operacoes']) {
  await assert.rejects(compile({ ...base, guide: { ...guide, steps: [{ ...guide.steps[0], text: value }] } }), /rota|caractere/iu, value);
}
for (const value of ['ІNTERNO: instrução restrita', 'INТERNO: instrução restrita', 'I\u200bNTERNO: instrução restrita', 'I\u00adNTERNO: instrução restrita']) {
  const kinds = sensitiveKinds(value);
  assert.equal(kinds.internal || kinds.control, true, `artigo precisa barrar ${value}`);
}
console.log('M5.19: gate final público, rotas completas e homóglifos passaram.');
