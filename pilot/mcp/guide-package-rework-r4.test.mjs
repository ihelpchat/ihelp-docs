import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { compileGuidePackage, routeSentenceEndPunctuation } from '../lib/guide-package.mjs';

const root = await mkdtemp(join(tmpdir(), 'm5-19-r4-'));
const dir = join(root, 'content/docs');
await mkdir(dir, { recursive: true });
const file = join(dir, 'guia.mdx');
const guide = {
  schemaVersion: 1, guideId: 'reconectar-canal-qr', version: 1, mode: 'real', initialStepId: 'inicio',
  steps: [{ stepId: 'inicio', text: 'Abra Canais.', choices: [{ id: 'achei', label: 'Achei' }] }],
};
const base = { title: 'Guia público', description: 'Orientação pública.', source: 'produto', contentType: 'guia', guide };
async function compile(text) {
  const metadata = { ...base, guide: { ...guide, steps: [{ ...guide.steps[0], text }] } };
  await writeFile(file, `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n${'Orientação pública de exemplo. '.repeat(65)}`);
  return compileGuidePackage(root);
}

for (const suffix of ['?next=%2Fadmin%2Foperacoes', '#frag', '?', '#', '/', '/../admin', '%2f', '&x=1', '?…', '😀']) {
  const text = `Abra /configuracoes/channel${suffix}`;
  await assert.rejects(compile(text), /rota fora do catálogo|caractere privado proibido/i, text);
}
for (const suffix of ['.', '…', '...']) {
  assert.equal(`/configuracoes/channel${suffix}`.replace(routeSentenceEndPunctuation, ''), '/configuracoes/channel', suffix);
}
for (const text of ['Abra /configuracoes/channel.', 'Abra /configuracoes/channel…', 'Abra /configuracoes/channel...', '(/configuracoes/channel)']) {
  await compile(text);
}
console.log('M5.19 r4: token completo da rota rejeitado; pontuação de frase aceita.');
