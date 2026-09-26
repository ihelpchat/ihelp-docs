import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashApprovedSentence, validateCanonicalGuide } from '../lib/canonical-guides.mjs';

const root = new URL('../content/docs/docs/', import.meta.url);
const cases = [
  ['principais-motivos-de-suporte/reconectar-canal-qr.mdx', 'reconectar-canal-qr'],
  ['principais-motivos-de-suporte/usuario-acesso.mdx', 'usuario-acesso'],
  ['sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario.mdx', 'recado-fora-do-horario'],
];
const originals = new Map();
for (const [path, id] of cases) {
  const raw = await readFile(join(root.pathname, path), 'utf8');
  originals.set(id, raw);
  assert.doesNotThrow(() => validateCanonicalGuide(raw, id), `${id}: texto atual aprovado`);
}

const qr = originals.get('reconectar-canal-qr');
const append = (sentence) => qr.replace('## Como confirmar', `${sentence}\n\n## Como confirmar`);
for (const sentence of [
  'Os textos enviados enquanto o WhatsApp ficou desconectado ficam guardados e aparecem no iHelp ao reconectar.',
  'Tudo fica salvo durante a desconexão.',
  'O histórico é mantido após reconectar.',
  'Abra a tela Canais, por favor.',
  'Os textos envi\u200bados enquanto o WhatsApp ficou desconectado ficam guardados e aparecem no iHelp ao reconectar.',
]) {
  assert.throws(() => validateCanonicalGuide(append(sentence), 'reconectar-canal-qr'),
    (error) => error.message.includes('frase não aprovada') && error.message.includes(sentence),
    `frase nova deve reprovar: ${sentence}`);
}
assert.throws(() => validateCanonicalGuide(qr.replace('No iHelp, abra Configurações e depois Canais.',
  'No iHelp, abra Configurações, e depois Canais.'), 'reconectar-canal-qr'),
  /frase não aprovada/u, 'alterar uma vírgula reprova');
assert.throws(() => validateCanonicalGuide(qr.replace('label="Abrir a tela Canais"',
  'label="As mensagens perdidas serão recuperadas"'), 'reconectar-canal-qr'),
  /frase não aprovada/u, 'label renderizado do ProductAction também reprova');
assert.doesNotThrow(() => validateCanonicalGuide(qr.replace('No iHelp, abra Configurações e depois Canais.',
  'No iHelp, abra Configurações e depois Ca\u200bnais.'), 'reconectar-canal-qr'),
  'invisível numa frase aprovada preserva o hash canônico');

const directory = await mkdtemp(join(tmpdir(), 'guides-approve-'));
try {
  const content = join(directory, 'content');
  const output = join(directory, 'approved.json');
  for (const [path, id] of cases) {
    const destination = join(content, path);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, originals.get(id));
  }
  const script = new URL('../scripts/approve-canonical-guides.mjs', import.meta.url).pathname;
  const run = () => execFileSync(process.execPath, [script, '--content-dir', content, '--output', output], { encoding: 'utf8' });
  const first = run();
  const approved = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(approved.aprovadoPor, 'pendente: Bruno');
  assert.equal(approved.aprovadoEm, null);
  assert.ok(approved.geradoEm);
  for (const [, id] of cases) {
    assert.ok(approved.guides[id].length > 5);
    for (const entry of approved.guides[id]) {
      assert.match(entry.hash, /^[a-f0-9]{64}$/u);
      assert.equal(entry.hash, hashApprovedSentence(entry.sentence));
    }
  }
  assert.match(first, /novas:/u);
  assert.match(run(), /novas: 0, alteradas: 0, removidas: 0/u);
  const changed = originals.get('reconectar-canal-qr').replace('No iHelp, abra Configurações e depois Canais.',
    'No iHelp, abra Configurações, e depois Canais.');
  await writeFile(join(content, cases[0][0]), changed);
  const delta = run();
  assert.match(delta, /alteradas: 1/u);
  assert.match(delta, /No iHelp, abra Configurações, e depois Canais\./u);
  assert.match(delta, /No iHelp, abra Configurações e depois Canais\./u);
  await writeFile(join(content, cases[0][0]), changed.replace('No iHelp, abra Configurações, e depois Canais.', ''));
  assert.match(run(), /removidas: 1/u);
} finally {
  await rm(directory, { recursive: true, force: true });
}
