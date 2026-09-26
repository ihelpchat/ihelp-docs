import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCanonicalGuide } from '../lib/canonical-guides.mjs';

const root = new URL('../', import.meta.url).pathname;
for (const [file, id] of [
  ['principais-motivos-de-suporte/reconectar-canal-qr.mdx', 'reconectar-canal-qr'],
  ['principais-motivos-de-suporte/usuario-acesso.mdx', 'usuario-acesso'],
  ['sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario.mdx', 'recado-fora-do-horario'],
]) validateCanonicalGuide(await readFile(join(root, 'content/docs/docs', file), 'utf8'), id);
const matrix = JSON.parse(await readFile(join(root, 'architecture/coverage-matrix.json'), 'utf8'));
const seenModules = new Set();
const allowedCoverage = new Set(['complete', 'partial', 'missing']);
const allowedPriorities = new Set(['P0', 'P1', 'P2']);

for (const row of matrix) {
  assert.ok(!seenModules.has(row.module), `Módulo duplicado: ${row.module}`);
  seenModules.add(row.module);
  assert.ok(allowedCoverage.has(row.coverage), `Cobertura inválida em ${row.module}`);
  assert.ok(allowedPriorities.has(row.priority), `Prioridade inválida em ${row.module}`);
  assert.ok(Array.isArray(row.productRoutes) && Array.isArray(row.docs) && Array.isArray(row.assets));

  for (const route of row.docs) {
    const relative = route.replace(/^\//, '');
    const direct = join(root, 'content/docs', `${relative}.mdx`);
    const index = join(root, 'content/docs', relative, 'index.mdx');
    const exists = await Promise.any([readFile(direct), readFile(index)]).then(() => true, () => false);
    assert.ok(exists, `Documento inexistente na matriz: ${route}`);
  }
}

const counts = Object.groupBy(matrix, (row) => row.coverage);
console.log(`Matriz válida: ${matrix.length} módulos; ${counts.complete?.length ?? 0} completos, ${counts.partial?.length ?? 0} parciais e ${counts.missing?.length ?? 0} ausentes.`);
