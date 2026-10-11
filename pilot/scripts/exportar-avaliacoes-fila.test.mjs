import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportQueueEvaluations } from './exportar-avaliacoes-fila.mjs';

const scores = { entende_modulo: 3, utilidade_negocio: 3, casos_concretos: 3,
  tarefas_completas: 3, clareza: 0, coerencia: 3 };

test('exporta só avaliações completas da fila com ambos os formatos de dump', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm579-export-'));
  try {
    const fila = join(root, 'fila'), notas = join(root, 'notas'), feedback = join(root, 'feedback');
    await Promise.all([mkdir(fila), mkdir(notas)]);
    await writeFile(join(fila, 'R6.json'), JSON.stringify({ data: { modulo: 'Robôs', texto: '## Publicar robô' } }));
    await writeFile(join(notas, 'R6.json'), JSON.stringify({ id: 'R6', version: 1,
      data: { amostra: 'R6', notas: scores, comentario: 'Rever clareza.' } }));
    await writeFile(join(fila, 'R8.json'), JSON.stringify({ id: 'R8', version: 2,
      data: { modulo: 'Contatos', texto: '## Abrir contato' } }));
    await writeFile(join(notas, 'R8.json'), JSON.stringify({ data: { amostra: 'R8',
      notas: { ...scores, clareza: 4, entende_modulo: 'na' }, comentario: '' } }));
    await writeFile(join(notas, 'R9.json'), JSON.stringify({ amostra: 'R9', notas: scores, comentario: '' }));
    await writeFile(join(fila, 'R10.json'), JSON.stringify({ modulo: 'Robôs', texto: '## Novo robô' }));
    await writeFile(join(notas, 'R10.json'), JSON.stringify({ amostra: 'R10',
      notas: { ...scores, clareza: undefined }, comentario: '' }));
    await writeFile(join(fila, 'A01.json'), JSON.stringify({ modulo: 'Fixo', texto: 'Amostra fixa' }));
    await writeFile(join(notas, 'A01.json'), JSON.stringify({ amostra: 'A01', notas: scores, comentario: '' }));
    await writeFile(join(fila, 'G03.json'), JSON.stringify({ modulo: 'Fixo', texto: 'Guardada fixa' }));
    await writeFile(join(notas, 'G03.json'), JSON.stringify({ amostra: 'G03', notas: scores, comentario: '' }));
    const result = await exportQueueEvaluations(fila, notas, feedback);
    assert.equal(result.itens, 2);
    const output = JSON.parse(await readFile(join(feedback, 'avaliacoes-fila.json'), 'utf8'));
    assert.deepEqual(output, { tipo: 'avaliacao-fila', itens: [
      { amostra: 'R6', modulo: 'Robôs', texto: '## Publicar robô', notas: scores, comentario: 'Rever clareza.' },
      { amostra: 'R8', modulo: 'Contatos', texto: '## Abrir contato',
        notas: { ...scores, clareza: 4, entende_modulo: 'na' }, comentario: '' },
    ] });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('exportação protege o caminho privado e recusa symlink no destino', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm579-export-'));
  const inside = await mkdtemp(join(import.meta.dirname, '.m579-export-'));
  try {
    const fila = join(root, 'fila'), notas = join(root, 'notas');
    await Promise.all([mkdir(fila), mkdir(notas)]);
    await assert.rejects(exportQueueEvaluations(fila, notas, inside), /fora do repo/u);
    assert.deepEqual(await readdir(inside), []);
    const target = join(root, 'target.json');
    await writeFile(target, 'intacto');
    const feedback = join(root, 'feedback');
    await mkdir(feedback);
    await symlink(target, join(feedback, 'avaliacoes-fila.json'));
    await assert.rejects(exportQueueEvaluations(fila, notas, feedback), /não aceita symlink/u);
    assert.equal(await readFile(target, 'utf8'), 'intacto');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(inside, { recursive: true, force: true });
  }
});
