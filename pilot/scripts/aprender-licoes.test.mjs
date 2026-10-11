import test from 'node:test';
import assert from 'node:assert/strict';
const { chooseHeldReview, validateCandidate, safeCandidate, publicLearningReport } =
  await import('./aprender-licoes-core.mjs').catch(() => ({}));
import { editorialPrompt } from '../mcp/faq-editorial-judge.mjs';
const { learnedWriterContract } = await import('../mcp/learned-editorial-guide.mjs').catch(() => ({}));

const scores = { entende_modulo: 3, utilidade_negocio: 3, casos_concretos: 3,
  tarefas_completas: 3, clareza: 3, coerencia: 3 };
const verdict = (aceite, clareza = 3, grave = false) => ({ aceite, notas: { ...scores, clareza },
  defeitosGraves: grave ? ['dado_ou_ambiente_de_teste'] : [] });

test('API do aprendizado disponível', () => {
  for (const value of [chooseHeldReview, validateCandidate, safeCandidate, publicLearningReport, learnedWriterContract])
    assert.equal(typeof value, 'function');
});

test('split da revisão é fixo e deixa seções fora do ajuste', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `contatos-${i + 1}`);
  const first = ids.filter(chooseHeldReview);
  assert.deepEqual(first, ids.slice().reverse().filter(chooseHeldReview).reverse());
  assert.ok(first.length >= 3 && first.length <= 7);
});

test('portão recusa regressão de aceite pelo juiz mockado', async () => {
  const held = [{ id: 'G01', bruno: { aceite: true, notas: scores, defeitosGraves: [] } },
    { id: 'G03', bruno: { aceite: false, notas: { ...scores, clareza: 1 }, defeitosGraves: ['dado_ou_ambiente_de_teste'] } }];
  const runJudge = async (row, withLesson) => row.id === 'G03' && withLesson
    ? verdict(true, 3) : row.id === 'G03' ? verdict(false, 1) : verdict(true);
  const result = await validateCandidate(held, runJudge);
  assert.equal(result.accepted, false);
  assert.equal(result.before.agreement, 2);
  assert.equal(result.after.agreement, 1);
  assert.equal(result.after.severeApproved, 1);
});

test('candidata não pode copiar comentário privado fictício', () => {
  const secret = 'COMENTARIO_PRIVADO_FICTICIO_741 O texto tem uma falha singular nesta etapa';
  assert.equal(safeCandidate({ texto: secret, criterio: 'clareza' }, [secret]), false);
  assert.equal(safeCandidate({ texto: 'Explique o resultado visível da ação.', criterio: 'clareza' }, [secret]), true);
});

test('relatório público contém só números', () => {
  const secret = 'COMENTARIO_PRIVADO_FICTICIO_741';
  const report = publicLearningReport([{ texto: secret, accepted: false, before: { agreement: 2, total: 4, meanError: 1 },
    after: { agreement: 1, total: 4, meanError: 2 } }]);
  assert.doesNotMatch(JSON.stringify(report), /COMENTARIO_PRIVADO_FICTICIO_741/);
  assert.equal(report.recusadas, 1);
});

test('guia versionado chega ao juiz e ao redator', () => {
  assert.match(editorialPrompt(), /lições editoriais aprendidas/u);
  assert.match(learnedWriterContract(), /lições editoriais aprendidas/u);
});
