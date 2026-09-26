import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { approvedGuideSentences, validateCanonicalGuide } from '../lib/canonical-guides.mjs';

const root = new URL('../content/docs/docs/', import.meta.url);
const cases = [
  ['principais-motivos-de-suporte/reconectar-canal-qr.mdx', 'reconectar-canal-qr', ['Android', 'iPhone', 'sem o celular', 'outra tela']],
  ['principais-motivos-de-suporte/usuario-acesso.mdx', 'usuario-acesso', ['criar', 'departamento', 'restrição']],
  ['sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario.mdx', 'recado-fora-do-horario', ['horário', 'mensagem', 'Salvar']],
];

for (const [file, id, required] of cases) {
  const raw = await readFile(join(root.pathname, file), 'utf8');
  const guide = validateCanonicalGuide(raw, id);
  assert.equal(guide.guideId, id);
  assert.ok(guide.steps.length >= 3);
  for (const word of required) assert.match(raw, new RegExp(word, 'iu'), `${id}: ${word}`);
  assert.throws(() => validateCanonicalGuide(raw.replace(/\{\/\* fonte:[^\n]+\*\/\}/u, ''), id), /fonte/iu, 'remover fonte de passo reprova');
  assert.throws(() => validateCanonicalGuide(raw.replace('## Como confirmar', 'As mensagens recebidas enquanto o canal estava desconectado serão recuperadas.\n\n## Como confirmar'), id), /mensagens|recuperad/iu, 'promessa de recuperação reprova');
}

const qr = await readFile(join(root.pathname, cases[0][0]), 'utf8');
for (const term of ['homologação', 'homologacao', 'staging', 'conta de teste', 'ambiente de teste']) {
  const publicCopy = qr.replace('## Como confirmar', `Confira em ${term}.\n\n## Como confirmar`);
  assert.throws(() => validateCanonicalGuide(publicCopy, 'reconectar-canal-qr'),
    /termo de ambiente interno/u, `termo interno no corpo público: ${term}`);
}
assert.throws(() => validateCanonicalGuide(qr.replace('Veja o código na tela', 'Veja o código em staging na tela'), 'reconectar-canal-qr'),
  /termo de ambiente interno/u, 'termo interno no metadata público');
const approved = 'As mensagens enviadas enquanto o WhatsApp estava desconectado podem não aparecer no iHelp. Se for importante, confira no celular.';
const withConfirmation = (sentence) => qr.replace('## Como confirmar', `${sentence}\n\n## Como confirmar`);
for (const sentence of [
  'As mensagens enviadas sem internet voltam ao iHelp.',
  'As mensagens chegam depois, quando o celular desligou.',
  'Nada se perde quando o celular desligou.',
  'A conversa volta sozinha.',
  'Voltam depois.',
  'As mensagens do período desconectado voltam ao reconectar.',
  'As mensagens que chegaram enquanto estava desconectado chegam depois.',
  'Você não perde nenhuma mensagem durante a desconexão.',
  'Nada se perde enquanto estiver fora do ar.',
  'As conversas de quando caiu aparecem depois.',
  'As mensagens recebidas enquanto o canal estava desconectado serão recuperadas.',
]) {
  assert.throws(
    () => validateCanonicalGuide(withConfirmation(sentence), 'reconectar-canal-qr'),
    (error) => error.message.includes(sentence),
    `frase fora da lista deve aparecer no erro: ${sentence}`,
  );
}
for (const sentence of [
  'As mensаgens enviadas sem internet voltam ao iHelp.', // a cirílico
  'As mensagens\u200b chegam depois, quando o celular desligou.',
]) {
  assert.throws(() => validateCanonicalGuide(withConfirmation(sentence), 'reconectar-canal-qr'),
    /frase/u, `homóglifo ou invisível não pode ocultar: ${sentence}`);
}
for (const [file, id] of cases) {
  const raw = await readFile(join(root.pathname, file), 'utf8');
  for (const sentence of approvedGuideSentences[id]) {
    if (!/[.!?]$/u.test(sentence)) continue; // Títulos sem pontuação já são validados no guia original.
    assert.doesNotThrow(() => validateCanonicalGuide(raw.replace('## Como confirmar', `${sentence}\n\n## Como confirmar`), id),
      `${id}: frase aprovada: ${sentence}`);
  }
}
assert.doesNotThrow(() => validateCanonicalGuide(withConfirmation(approved), 'reconectar-canal-qr'));
assert.throws(
  () => validateCanonicalGuide(withConfirmation('Mensagens OFFLINE aparecem depois!'), 'reconectar-canal-qr'),
  /Mensagens OFFLINE aparecem depois!/u,
  'normalização de acentos e caixa não libera frase fora da lista',
);
assert.throws(
  () => validateCanonicalGuide(qr.replace('No iHelp, abra Configurações e depois Canais.', 'Mensagens offline chegam depois. No iHelp, abra Configurações e depois Canais.'), 'reconectar-canal-qr'),
  /Mensagens offline chegam depois/u,
  'texto dos passos publicados também é validado',
);
console.log('M5.21: três guias, fontes por passo e promessa offline validados.');
