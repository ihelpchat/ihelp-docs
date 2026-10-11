import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITORIAL_CRITERIA } from '../mcp/faq-editorial-judge.mjs';
import { assertPrivateFile, outsideRepo } from './private-output-path.mjs';
import { installPrivateCliErrorHandler, PrivateCliError } from './private-cli-error.mjs';

const unwrap = (value) => value && typeof value === 'object' && !Array.isArray(value)
  && value.data && typeof value.data === 'object' && !Array.isArray(value.data)
  ? value.data : value;

async function readCollection(dir) {
  if (!outsideRepo(await realpath(dir))) throw new Error('dump deve ficar fora do repo');
  const documents = new Map();
  for (const [index, file] of (await readdir(dir)).filter((name) => name.endsWith('.json')).sort().entries()) {
    const id = basename(file, '.json');
    let data;
    try { data = JSON.parse(await readFile(join(dir, file), 'utf8')); }
    catch { throw new PrivateCliError('dump ilegível ou JSON inválido', index + 1); }
    documents.set(id, unwrap(data));
  }
  return documents;
}

const complete = (notas) => notas && typeof notas === 'object'
  && EDITORIAL_CRITERIA.every((criterion) => notas[criterion] === 'na'
    || (Number.isInteger(notas[criterion]) && notas[criterion] >= 0 && notas[criterion] <= 4));

export async function exportQueueEvaluations(queueDir, notesDir, feedbackDir) {
  const output = resolve(feedbackDir, 'avaliacoes-fila.json');
  if (!outsideRepo(await realpath(dirname(resolve(feedbackDir)))))
    throw new Error('FEEDBACK_DIR deve ficar fora do repo');
  const [queue, notes] = await Promise.all([readCollection(queueDir), readCollection(notesDir)]);
  const itens = [];
  for (const [id, note] of notes) {
    if (/^[AG]0\d+$/iu.test(id) || !queue.has(id) || !note || note.amostra !== id || !complete(note.notas)) continue;
    const source = queue.get(id);
    if (typeof source?.modulo !== 'string' || !source.modulo.trim()
      || typeof source.texto !== 'string' || !source.texto.trim()
      || typeof note.comentario !== 'string') continue;
    const item = { amostra: id, modulo: source.modulo, texto: source.texto,
      notas: note.notas, comentario: note.comentario };
    if (note.defeitosGraves !== undefined) item.defeitosGraves = note.defeitosGraves;
    itens.push(item);
  }
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await assertPrivateFile(output, 'FEEDBACK_DIR');
  await writeFile(output, `${JSON.stringify({ tipo: 'avaliacao-fila', itens }, null, 2)}\n`, { mode: 0o600 });
  return { itens: itens.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installPrivateCliErrorHandler();
  if (process.argv.length !== 4 || !process.env.FEEDBACK_DIR)
    throw new Error('uso: FEEDBACK_DIR=<dir-privado> node pilot/scripts/exportar-avaliacoes-fila.mjs <dir-fila> <dir-notas>');
  console.log(JSON.stringify(await exportQueueEvaluations(process.argv[2], process.argv[3], process.env.FEEDBACK_DIR)));
}
