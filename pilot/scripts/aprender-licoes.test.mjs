import test from 'node:test';
import assert from 'node:assert/strict';
const { chooseHeldReview, validateCandidate, safeCandidate, publicLearningReport, resolveReviewSection,
  validateInitialLessons, firstJsonObject } =
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

test('portão recusa lição sem ganho medido', async () => {
  const held = [{ id: 'G01', bruno: { aceite: true, notas: scores, defeitosGraves: [] } }];
  const result = await validateCandidate(held, async () => verdict(true));
  assert.equal(result.accepted, false);
});

test('portão preserva cada acerto mesmo quando a média melhora', async () => {
  const held = [
    { id: 'certo', bruno: { aceite: true, notas: scores, defeitosGraves: [] } },
    ...['erro-1', 'erro-2'].map((id) => ({ id, bruno: { aceite: true, notas: scores, defeitosGraves: [] } })),
  ];
  const result = await validateCandidate(held, async (row, withLesson) =>
    verdict(withLesson ? row.id !== 'certo' : row.id === 'certo'));
  assert.equal(result.before.agreement, 1);
  assert.equal(result.after.agreement, 2);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.cases.map(({ id, before, after }) => ({ id, before, after })), [
    { id: 'certo', before: true, after: false },
    { id: 'erro-1', before: false, after: true },
    { id: 'erro-2', before: false, after: true },
  ]);
});

test('lições iniciais são validadas separadamente e só aprovadas ficam ativas', async () => {
  const held = [{ id: 'caso', bruno: { aceite: true, notas: scores, defeitosGraves: [] } }];
  const lessons = [{ id: 'L001', texto: 'Primeira lição de teste.', criterio: 'clareza', vetada: false },
    { id: 'L002', texto: 'Segunda lição de teste.', criterio: 'clareza', vetada: false }];
  const result = await validateInitialLessons(lessons, held, async (_row, active) => verdict(active.some((x) => x.id === 'L001')));
  assert.deepEqual(result.active.map((x) => x.id), ['L001']);
  assert.deepEqual(result.observations.map((x) => x.id), ['L002']);
  assert.equal(result.lessons[1].vetada, true);
});

test('candidata não pode copiar comentário privado fictício', () => {
  const secret = 'COMENTARIO_PRIVADO_FICTICIO_741 O texto tem uma falha singular nesta etapa';
  assert.equal(safeCandidate({ texto: secret, criterio: 'clareza' }, [secret]), false);
  assert.equal(safeCandidate({ texto: 'Explique o resultado visível da ação.', criterio: 'clareza' }, [secret]), true);
});

test('candidata recusa identificadores sintéticos e quatro palavras privadas consecutivas', () => {
  const comments = ['Ana Beatriz da Empresa Aurora ligou para 11987654321. O caso exige conferir o botão azul antes de salvar.'];
  for (const texto of [
    'Use o caso de Ana Beatriz para orientar a pessoa.',
    'Peça a Ana que confira o resultado antes de prosseguir.',
    'A Empresa Aurora deve conferir o resultado antes de salvar.',
    'Ligue para 11987654321 antes de explicar a tarefa.',
    'Escreva para ajuda@example.com antes de orientar.',
    'Use o identificador abc-12345 para localizar a página.',
    'Use o identificador ABC123 para localizar a página.',
    'O caso exige conferir o botão antes de salvar.',
  ]) assert.equal(safeCandidate({ texto, criterio: 'clareza' }, comments), false, texto);
  assert.equal(safeCandidate({ texto: 'Explique o resultado observável da ação para orientar o próximo passo.',
    criterio: 'clareza' }, comments), true);
});

test('revisão de Robôs usa página e seção da origem; seção ausente é pulada', async () => {
  const root = new URL('../architecture/faq-regua/', import.meta.url).pathname;
  const found = await resolveReviewSection({ pagina: 'robos', titulo: 'O que é' }, root);
  assert.match(found, /^## O que é/mu);
  assert.equal(await resolveReviewSection({ pagina: 'robos', titulo: 'Seção que não existe' }, root), null);
  assert.match(await resolveReviewSection({ pagina: 'contatos', titulo: 'Definir quem cuida de um contato' }, root),
    /^## Definir o responsável por um contato/mu);
});

test('leitura privada isola o primeiro veredito JSON completo quando Luna repete objetos', () => {
  assert.deepEqual(firstJsonObject('{"ok":true}{"ok":false}'), { ok: true });
  assert.deepEqual(firstJsonObject(' {"texto":"chave } interna"}\n{"outro":1}'), { texto: 'chave } interna' });
  assert.throws(() => firstJsonObject('{"ok":'), SyntaxError);
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

test('lição vetada no juiz preserva o contrato do redator', () => {
  const original = 'Não leve dados, cenários ou instruções de ensaio';
  assert.doesNotMatch(editorialPrompt([], true, []), /Não leve dados, cenários ou instruções de ensaio/u);
  assert.match(learnedWriterContract(), /Não leve dados, cenários ou instruções de ensaio/u);
});
