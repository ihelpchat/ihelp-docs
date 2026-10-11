import test from 'node:test';
import assert from 'node:assert/strict';
const { chooseHeldReview, validateCandidate, safeCandidate, publicLearningReport, resolveReviewSection,
  validateInitialLessons, firstJsonObject, loadFeedback, candidateRejectionReason } =
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
  assert.equal(result.lessons[1].ativa, false);
  assert.equal(result.lessons[1].vetada, false);
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

test('palavra presente só no feedback privado impede publicação mesmo em minúsculas', () => {
  const comments = ['o cliente carlos migrou uma conta especial'];
  assert.equal(safeCandidate({ texto: 'Oriente o cliente carlos ao migrar uma conta especial.', criterio: 'clareza' }, comments), false);
  assert.equal(safeCandidate({ texto: 'Explique o resultado da ação para orientar o cliente.', criterio: 'clareza' }, comments), true);
});

test('lista fechada recusa nomes mesmo quando existem em páginas públicas', async () => {
  for (const name of ['ana', 'carlos']) {
    const comments = [`o cliente ${name} teve uma dúvida sobre atendimento`];
    const candidate = { texto: `Ao orientar o cliente ${name}, explique o resultado da ação antes de avançar.`, criterio: 'clareza' };
    assert.equal(candidateRejectionReason(candidate, comments), 'vocabulário');
    assert.equal(safeCandidate(candidate, comments), false);
  }
  const { licoes } = JSON.parse(await (await import('node:fs/promises')).readFile(
    new URL('../architecture/faq-regua/guia-aprendido.json', import.meta.url), 'utf8'));
  for (const lesson of licoes.filter(({ ativa }) => ativa))
    assert.equal(candidateRejectionReason(lesson, []), null, lesson.id);
});

test('nova revisão entra no digest e no sorteio sem redistribuir casos antigos', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'm579-feedback-'));
  try {
    await writeFile(join(dir, 'antigas.json'), JSON.stringify({ secoes: [
      { secao: 'contatos-1', pagina: 'contatos', titulo: 'O que é', decisao: 'ajustar', comentario: 'Exemplo' },
    ] }));
    const first = await loadFeedback(dir);
    await writeFile(join(dir, 'nova.json'), JSON.stringify({ secao: 'robos-1', pagina: 'robos', titulo: 'O que é', decisao: 'ajustar', comentario: 'Outro exemplo' }));
    const second = await loadFeedback(dir);
    assert.notEqual(first.digest, second.digest);
    assert.equal(second.review.length, first.review.length + 1);
    assert.equal(second.review.at(-1).pagina, 'robos');
    assert.equal(chooseHeldReview(first.review[0].secao), chooseHeldReview(second.review[0].secao));
    assert.equal(typeof chooseHeldReview(second.review.at(-1).secao), 'boolean');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('duas execuções sem feedback novo ignoram saídas privadas no digest', async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'm579-feedback-'));
  try {
    await writeFile(join(dir, 'revisao.json'), JSON.stringify({ pagina: 'contatos', titulo: 'O que é', decisao: 'ajustar' }));
    const first = await loadFeedback(dir);
    await mkdir(join(dir, '.saida'));
    await writeFile(join(dir, '.saida', 'relatorio-aprendizado-privado.json'), '{"detalhe":"privado"}');
    await writeFile(join(dir, '.saida', '.m5-79-processado.json'), '{"sourceDigest":"antigo"}');
    await writeFile(join(dir, 'relatorio-aprendizado-privado.json'), '{"detalhe":"legado"}');
    await writeFile(join(dir, '.m5-79-cache.json'), '{"candidates":[]}');
    const second = await loadFeedback(dir);
    assert.equal(second.digest, first.digest);
    assert.deepEqual(second.review, first.review);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('segunda execução do script pula sem feedback novo', async () => {
  const { mkdtemp, writeFile, mkdir, rm, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { spawnSync } = await import('node:child_process');
  const external = await mkdtemp(join(tmpdir(), 'm579-skip-'));
  const feedbackDir = join(external, 'feedback');
  const outputDir = join(feedbackDir, '.saida');
  const privateReport = join(external, 'relatorio.json');
  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(feedbackDir, 'revisao.json'), '{"amostras":[]}');
    await writeFile(privateReport, '{}');
    const feedback = await loadFeedback(feedbackDir);
    const sourceDigest = createHash('sha256').update(JSON.stringify({ feedback: feedback.digest, paginas: [] })).digest('hex');
    await writeFile(join(outputDir, '.m5-79-processado.json'), JSON.stringify({ sourceDigest }));
    const run = () => spawnSync(process.execPath, [join(import.meta.dirname, 'aprender-licoes.mjs')], {
      cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8', env: { ...process.env,
        FEEDBACK_DIR: feedbackDir, LEARNING_PRIVATE_REPORT_FILE: privateReport, OPENAI_API_KEY: 'teste' },
    });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    await writeFile(join(outputDir, 'relatorio-aprendizado-privado.json'), '{"gerado":true}');
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.deepEqual(await readdir(outputDir), ['.m5-79-processado.json', 'relatorio-aprendizado-privado.json']);
  } finally { await rm(external, { recursive: true, force: true }); }
});

test('execução recusa diretório privado interno e symlink antes de gravar', async () => {
  const { mkdtemp, symlink, rm, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const repo = resolve(import.meta.dirname, '../..');
  const internal = await mkdtemp(join(import.meta.dirname, '.m579-internal-'));
  const external = await mkdtemp(join(tmpdir(), 'm579-external-'));
  try {
    const alias = join(external, 'alias');
    await symlink(internal, alias);
    for (const feedbackDir of [internal, alias]) {
      const result = spawnSync(process.execPath, [join(import.meta.dirname, 'aprender-licoes.mjs')], {
        cwd: repo, encoding: 'utf8', env: { ...process.env, FEEDBACK_DIR: feedbackDir,
          LEARNING_PRIVATE_REPORT_FILE: join(external, 'relatorio.json'), OPENAI_API_KEY: 'teste' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /FEEDBACK_DIR.*fora do repo/u);
      assert.deepEqual(await readdir(internal), []);
    }
  } finally {
    await rm(internal, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
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

test('relatório público contém só agregados e ids de lição', () => {
  const cases = [{ id: 'G01', before: true, after: false },
    { id: 'contatos-01', before: false, after: true }];
  const metric = (agreement, meanError) => ({ total: 2, agreement, meanError, severeApproved: 0 });
  const report = publicLearningReport({ ajuste: 3, guardadas: 2,
    iniciais: { before: metric(1, 1.5), after: metric(1, 1), cases },
    lessons: [{ id: 'L001', accepted: false, before: metric(1, 1.5), after: metric(1, 1), cases }],
    candidates: [{ id: 'L002', texto: 'COMENTARIO_PRIVADO_FICTICIO_741', accepted: true,
      before: metric(1, 1), after: metric(2, 0.5), cases }] });
  assert.deepEqual(Object.keys(report).sort(), ['ajuste', 'guardadas', 'iniciais', 'licoes']);
  assert.deepEqual(report.iniciais, { acertosAntes: 1, acertosDepois: 1, regressoes: 1,
    erroMedioAntes: 1.5, erroMedioDepois: 1 });
  assert.deepEqual(report.licoes.map(({ id, aceita }) => [id, aceita]), [['L001', false], ['L002', true]]);
  for (const lesson of report.licoes)
    assert.deepEqual(Object.keys(lesson).sort(), ['aceita', 'acertosAntes', 'acertosDepois', 'erroMedioAntes',
      'erroMedioDepois', 'id', 'regressoes']);
  assert.doesNotMatch(JSON.stringify(report), /G01|contatos-01|caso-|COMENTARIO_PRIVADO_FICTICIO_741/u);
});

test('relatório versionado não contém chave nem hash por caso', async () => {
  const { readFile } = await import('node:fs/promises');
  const report = await readFile(new URL('../architecture/faq-regua/relatorio-aprendizado.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(report);
  assert.deepEqual(Object.keys(parsed).sort(), ['ajuste', 'guardadas', 'iniciais', 'licoes']);
  assert.ok(parsed.licoes.every(({ id }) => /^L\d{3}$/u.test(id)));
  assert.doesNotMatch(report, /porCaso|cases|caso-[a-f0-9]+|contatos-0[347]/u);
  const { createHash } = await import('node:crypto');
  for (const id of [...Array.from({ length: 99 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 99 }, (_, i) => `contatos-${String(i + 1).padStart(2, '0')}`)]) {
    assert.doesNotMatch(report, new RegExp(createHash('sha256').update(`${id}:M5.79:caso-publico:v1`).digest('hex').slice(0, 8), 'u'));
  }
});

test('lição não pode reproduzir id, seção ou título do feedback privado', () => {
  const candidate = { texto: 'Explique o resultado observável da ação para orientar o próximo passo.', criterio: 'clareza' };
  assert.equal(candidateRejectionReason(candidate, [], ['resultado observável']), 'privacidade');
  assert.equal(candidateRejectionReason(candidate, [], ['cliente-privado-123']), null);
});

test('guia versionado chega ao juiz e ao redator', () => {
  assert.match(editorialPrompt(), /lições editoriais aprendidas/u);
  assert.match(learnedWriterContract(), /lições editoriais aprendidas/u);
});

test('regra do dono inativa no juiz preserva o contrato do redator', () => {
  assert.doesNotMatch(editorialPrompt(), /Não leve dados, cenários ou instruções de ensaio/u);
  assert.match(editorialPrompt(), /Uma tarefa ensinada precisa chegar ao resultado observável/u);
  assert.match(learnedWriterContract(), /Não leve dados, cenários ou instruções de ensaio/u);
  assert.match(learnedWriterContract(), /Uma tarefa ensinada precisa chegar ao resultado observável/u);
});

test('redator mantém regra do dono recusada pelo juiz, mas exclui aprendida recusada', () => {
  const guide = [
    { id: 'L002', texto: 'Regra explícita do dono.', criterio: 'clareza', origem: 'regra-do-dono', ativa: false, vetada: false },
    { id: 'L099', texto: 'Lição aprendida recusada.', criterio: 'clareza', origem: 'aprendida', ativa: false, vetada: false },
  ];
  assert.match(learnedWriterContract(guide), /Regra explícita do dono/u);
  assert.doesNotMatch(learnedWriterContract(guide), /Lição aprendida recusada/u);
  assert.doesNotMatch(editorialPrompt([], true, guide), /Lição aprendida recusada/u);
});
