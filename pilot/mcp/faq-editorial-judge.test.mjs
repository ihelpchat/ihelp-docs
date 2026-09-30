import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { judgeEditorial, parseEditorialVerdict, aggregateCalibration, publicCalibrationReport } =
  await import('./faq-editorial-judge.mjs').catch(() => ({}));

const ids = ['entende_modulo', 'utilidade_negocio', 'casos_concretos', 'tarefas_completas', 'clareza', 'coerencia'];
const scores = Object.fromEntries(ids.map((id) => [id, 3]));
const verdict = { notas: scores, defeitosGraves: [], naoVerificaveis: [], comentario: 'Texto claro.' };

test('juiz editorial disponível', () => assert.equal(typeof judgeEditorial, 'function'));

test('parsing exige as seis notas inteiras, categorias conhecidas e campos exatos', () => {
  assert.deepEqual(parseEditorialVerdict(JSON.stringify(verdict)), { ...verdict, aceite: true });
  assert.throws(() => parseEditorialVerdict(JSON.stringify({ ...verdict, notas: { ...scores, clareza: 4.5 } })));
  assert.throws(() => parseEditorialVerdict(JSON.stringify({ ...verdict, defeitosGraves: ['categoria_inventada'] })));
  assert.throws(() => parseEditorialVerdict(JSON.stringify({ ...verdict, extra: 'vaza' })));
  assert.equal(parseEditorialVerdict(JSON.stringify({ ...verdict, defeitosGraves: ['contradiz_evidencia'] })).aceite, false);
});

test('ausência de prova fica separada de contradição factual grave', () => {
  const unknown = parseEditorialVerdict({ ...verdict, naoVerificaveis: ['O resultado da operação não foi comprovado.'] });
  assert.equal(unknown.aceite, true);
  assert.deepEqual(unknown.naoVerificaveis, ['O resultado da operação não foi comprovado.']);
  assert.equal(parseEditorialVerdict({ ...verdict, naoVerificaveis: [], defeitosGraves: ['contradiz_evidencia'] }).aceite, false);
  assert.equal(parseEditorialVerdict({ ...verdict, naoVerificaveis: [], defeitosGraves: ['funcao_inexistente'] }).aceite, false);
});

test('modelo mockado recebe página, módulo e evidências sem notas guardadas', async () => {
  let request;
  const judged = await judgeEditorial({ pagina: 'Um trecho', modulo: 'Robôs', evidencias: { front: [], negocio: [], jornadas: [] } },
    async (input) => { request = input; return { output_text: JSON.stringify(verdict), usage: { input_tokens: 20, output_tokens: 10 } }; });
  assert.equal(judged.aceite, true);
  assert.match(request.input, /Um trecho/);
  assert.doesNotMatch(JSON.stringify(request), /G01|G02|G03|G04|comentario secreto/);
  assert.deepEqual(judged.usage, { input_tokens: 20, output_tokens: 10 });
});

test('agregação cega calcula acordo, defeitos aceitos e erro médio por critério', () => {
  const rows = [
    { id: 'G01', grupo: 'guardada', bruno: { notas: scores }, juiz: { ...verdict, aceite: true } },
    { id: 'G02', grupo: 'guardada', bruno: { notas: { ...scores, clareza: 1 } }, juiz: { ...verdict, notas: { ...scores, clareza: 2 }, aceite: false } },
    { id: 'G03', grupo: 'guardada', bruno: { notas: { ...scores, coerencia: 1 }, defeitosGraves: ['produto_sem_evidencia'] },
      juiz: { ...verdict, aceite: true, defeitosGraves: ['produto_sem_evidencia'] } },
  ];
  const result = aggregateCalibration(rows);
  assert.equal(result.concordancia, 2);
  assert.equal(result.defeitosGravesAprovados, 1);
  assert.equal(result.erroMedioPorCriterio.clareza, 1 / 3);
});

test('relatório público descarta comentário falso de arquivo privado', async () => {
  const secret = 'COMENTARIO_FALSO_PRIVADO_741';
  const dir = await mkdtemp(join(tmpdir(), 'faq-judge-'));
  try {
    const notesPath = join(dir, 'notas.json');
    await writeFile(notesPath, JSON.stringify({ amostras: [{ amostra: 'G01', notas: scores, comentario: secret }] }));
    const note = JSON.parse(await readFile(notesPath, 'utf8')).amostras[0];
    const rows = [{ id: 'G01', grupo: 'guardada', texto: secret,
      bruno: note, juiz: { ...verdict, comentario: secret, naoVerificaveis: [secret], aceite: true } }];
    const report = publicCalibrationReport(rows, { model: 'mock', inputTokens: 1, outputTokens: 1, costUsd: 0 });
    assert.doesNotMatch(JSON.stringify(report), /COMENTARIO_FALSO_PRIVADO_741/);
    assert.deepEqual(report.amostras[0].juiz.defeitosGraves, []);
    assert.equal(report.amostras[0].juiz.naoVerificaveisCount, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
