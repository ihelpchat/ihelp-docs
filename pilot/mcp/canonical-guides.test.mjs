import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCanonicalGuide } from '../lib/canonical-guides.mjs';

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
console.log('M5.21: três guias, fontes por passo e promessa offline validados.');
