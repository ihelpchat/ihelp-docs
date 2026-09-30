import test from 'node:test';
import assert from 'node:assert/strict';
import * as generator from './faq-generator-v2.mjs';
const { planFaqPage, assembleFaqPage, runFaqJudgment } = generator;

const task = { id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'cadastrar' };
const evidence = [{ id: 'J1', type: 'jornada', task: task.id, status: 'concluída', text: 'Salvar mostra o contato na lista.' }];
const page = { title: 'Contatos', sections: [
  { heading: 'O que é', units: [{ text: 'Contatos reúne os cadastros da equipe.', evidenceIds: ['J1'] }] },
  { heading: 'Adicionar contato', taskId: task.id, units: [{ text: 'Clique em Salvar e veja o contato na lista.', kind: 'passo', evidenceIds: ['J1'] }] },
] };
const passing = { notas: Object.fromEntries(['entende_modulo', 'utilidade_negocio', 'casos_concretos', 'tarefas_completas', 'clareza', 'coerencia'].map((id) => [id, 3])), defeitosGraves: [], naoVerificaveis: [], aceite: true };

test('montagem preserva toda frase aprovada e detecta perda', () => {
  const mdx = assembleFaqPage(page);
  assert.match(mdx, /Contatos reúne os cadastros da equipe\./u);
  assert.deepEqual(assembleFaqPage(page, { render: () => '# Contatos' }).losses, [
    'Contatos reúne os cadastros da equipe.', 'Clique em Salvar e veja o contato na lista.',
  ]);
});

test('toda afirmação exige evidência vinculada e sustentada pelo juiz factual', async () => {
  const verdict = await runFaqJudgment(page, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['J1'], reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(verdict.approved, true);
  assert.equal(verdict.trace.filter(({ field }) => field.includes('.units[')).length, 2);
  assert.ok(verdict.trace.some(({ field }) => field === 'title'));
  const correctedCitation = await runFaqJudgment(page, [...evidence,
    { id: 'F2', type: 'front', text: 'Contatos reúne cadastros.' }], {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['F2'], reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(correctedCitation.approved, true);
  assert.deepEqual(correctedCitation.trace[0].evidence, [{ id: 'F2', type: 'front' }]);
  assert.equal((await runFaqJudgment({ ...page, sections: [{ heading: 'O que é', units: [{ text: 'Sem prova.', evidenceIds: [] }] }] }, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: [], reason: '' })),
    judgeEditorial: async () => passing,
  })).approved, false);
});

test('uma única correção; segunda reprovação vai para revisão humana', async () => {
  let writes = 0;
  let feedback;
  const result = await runFaqJudgment(page, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['J1'], reason: '' })),
    judgeEditorial: async () => ({ ...passing, notas: { ...passing.notas, clareza: 2 },
      comments: ['A ordem entre tarefas confunde o leitor.'], aceite: false }),
    rewrite: async (_page, report) => { writes++; feedback = report.editorial.comments; return page; },
  });
  assert.equal(writes, 1);
  assert.deepEqual(feedback, ['A ordem entre tarefas confunde o leitor.']);
  assert.equal(result.corrections, 1);
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.mdx, undefined);
});

test('tarefa sem jornada concluída não recebe passos nem resultado inventado', () => {
  const plan = planFaqPage('contatos', [task], [{ task: task.id, status: 'bloqueada' }]);
  assert.equal(plan.tasks[0].status, 'sem jornada');
  assert.deepEqual(plan.tasks[0].journeyEvidenceIds, []);
  assert.equal(plan.reviewTasks[0], task.id);
  const unverified = planFaqPage('contatos', [task], [{ task: task.id, status: 'concluída',
    accountProof: 'opaque', identityVerified: false, verification: { confirmed: true } }]);
  assert.equal(unverified.tasks[0].status, 'sem jornada');
});

test('guia ausente ou passo de tarefa sem jornada impede a saída', async () => {
  const plan = planFaqPage('contatos', [task], [{ task: task.id, status: 'bloqueada' }]);
  const providers = {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['J1'], reason: '' })),
    judgeEditorial: async () => passing,
  };
  const absent = await runFaqJudgment({ title: 'Contatos', sections: [page.sections[0]] }, evidence, providers, { plan });
  assert.equal(absent.status, 'precisa de revisão humana');
  assert.ok(absent.diagnostic.includes(`tarefa ausente: ${task.id}`));
  const invented = await runFaqJudgment(page, evidence, providers, { plan });
  assert.equal(invented.status, 'precisa de revisão humana');
  assert.ok(invented.diagnostic.some((item) => item.includes('passo ou efeito sem tarefa com jornada concluída')));
});

test('O que acontece depois exige decisão factual baseada na jornada concluída', async () => {
  const withAfter = { ...page, sections: [{ ...page.sections[1], units: [
    { text: 'Depois de salvar, o contato aparece na lista.', kind: 'depois', evidenceIds: ['J1'] },
  ] }] };
  const facts = [...evidence, { id: 'F2', type: 'front', text: 'Lista de contatos.' }];
  const result = await runFaqJudgment(withAfter, facts, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['F2'], reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.ok(result.diagnostic.some((item) => item.includes('efeito sem evidência da jornada concluída')));
  const nextJourney = await runFaqJudgment(withAfter, [...facts,
    { id: 'J2', type: 'jornada', task: 'contatos.buscar', status: 'concluída', text: 'A lista oferece busca.' }], {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['J2'], reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(nextJourney.status, 'aprovado');
  assert.deepEqual(nextJourney.trace[0].evidence, [
    { id: 'J2', type: 'jornada' }, { id: 'J1', type: 'jornada' },
  ]);
});

test('referência a outro guia da própria página não vira menção a fonte interna', async () => {
  const internalLink = { title: 'Robôs', sections: [{ heading: 'Salvar o fluxo', units: [
    { text: 'Siga o guia “Configurar o encaminhamento” desta página.', evidenceIds: ['J1'] },
  ] }] };
  const result = await runFaqJudgment(internalLink, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada',
      evidenceIds: ['J1'], sourceMention: true, reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(result.status, 'aprovado');
  const source = await runFaqJudgment({ ...internalLink, sections: [{ heading: 'Salvar o fluxo', units: [
    { text: 'Segundo o segundo cérebro, este fluxo é salvo.', evidenceIds: ['J1'] },
  ] }] }, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada',
      evidenceIds: ['J1'], sourceMention: false, reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(source.status, 'precisa de revisão humana');
});

test('redator recebe só observações do produto e glossário, sem texto da verificação', async () => {
  assert.equal(typeof generator.projectFaqEvidence, 'function');
  assert.equal(typeof generator.faqWriterInput, 'function');
  assert.equal(typeof generator.faqWriterInstructions, 'function');
  const journey = { task: task.id, status: 'concluída', verification: {
    confirmed: true, observed: 'Ficha reaberta; identidade e persistência confirmadas pelo marcador ref.' },
  before: { generatedRows: '1' }, after: { generatedRows: '1' },
  actions: [{ type: 'click', role: 'button', name: 'Salvar' }],
  screens: [{ title: 'Contatos', controlsOffered: [{ role: 'button', name: 'Salvar' }],
    messages: ['Contato criado com sucesso!'], state: { headings: 'Contatos', generatedRows: '1' } }] };
  const plan = planFaqPage('contatos', [{ ...task, pontoDePartida: 'Ficha reaberta para conferir' }], [journey]);
  const evidence = generator.projectFaqEvidence(plan, [journey], { screenFacts: [] }, []);
  const prompt = generator.faqWriterInput(plan, [{ ...task, pontoDePartida: 'Ficha reaberta para conferir' }],
    evidence, [{ task: task.id, screenshotId: 'a'.repeat(64), approval: 'pendente' }]);
  assert.match(prompt, /Contato criado com sucesso!/u);
  assert.match(prompt, /"concluida":true/u);
  assert.doesNotMatch(prompt, /Ficha reaberta|identidade|persistência|marcador|"ref"|generatedRows|screenshotId/u);
  const instructions = generator.faqWriterInstructions(['regras de seções']);
  assert.match(instructions, /gloss[aá]rio|vocabulario/iu);
  assert.match(instructions, /ficha.*contato/isu);
  assert.match(instructions, /cada tarefa concluída.*resultado/isu);
  assert.match(instructions, /casos.*evidência/isu);
});

test('afirmação sustentada só por mecânica da verificação não entra na página', async () => {
  const onlyVerification = [{ id: 'V1', type: 'verificacao', task: task.id, completed: true }];
  const claimPage = { title: 'Contatos', sections: [{ heading: 'Cadastrar contato', taskId: task.id, units: [
    { text: 'A persistência foi confirmada ao reabrir a ficha.', kind: 'contexto', evidenceIds: ['V1'] },
  ] }] };
  const result = await runFaqJudgment(claimPage, onlyVerification, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['V1'], reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.match(result.diagnostic.join(' '), /evidência|verificação/u);
});

test('numeração do modelo é apenas formato; pergunta não vira afirmação factual', async () => {
  const numbered = { title: 'Contatos', sections: [{ heading: 'Cadastrar', taskId: task.id, units: [
    { text: '1. Clique em Salvar.', kind: 'passo', evidenceIds: ['J1'] },
    { text: 'O contato aparece na lista?', kind: 'contexto', evidenceIds: ['J1'] },
  ] }] };
  const result = await runFaqJudgment(numbered, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['J1'], reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(result.status, 'aprovado');
  assert.deepEqual(result.trace.filter(({ field }) => field.includes('.units[')).map(({ claim }) => claim),
    ['Clique em Salvar.']);
  assert.match(result.mdx, /1\. Clique em Salvar\./u);
  assert.doesNotMatch(result.mdx, /1\. 1\./u);
});

test('título, descrição, headings, links e legendas entram no trace factual', async () => {
  const claimPage = { title: 'Robôs garantem vendas em dobro',
    description: 'Robôs garantem clientes novos', sections: [
      { heading: 'Robôs vendem sem atendimento', taskId: task.id, units: [
        { text: 'O botão Menu de opções aparece na tela.', kind: 'contexto', evidenceIds: ['J1'] },
        { text: 'Veja [Robôs dobram suas vendas](/docs/robos).', kind: 'contexto', evidenceIds: ['J1'] },
        { text: '![Robôs garantem resultado](/img/help/robos.png)', kind: 'contexto', evidenceIds: ['J1'] },
      ] },
    ] };
  const unsupported = new Set([claimPage.title, claimPage.description,
    claimPage.sections[0].heading, 'Robôs dobram suas vendas', 'Robôs garantem resultado']);
  const result = await runFaqJudgment(claimPage, evidence, {
    judgeFacts: async (claims) => claims.map(({ id, text }) => ({ id,
      status: unsupported.has(text) ? 'a confirmar' : 'sustentada',
      evidenceIds: ['J1'], reason: unsupported.has(text) ? 'sem prova' : '' })),
    judgeEditorial: async () => passing,
    rewrite: async () => claimPage,
  });
  for (const text of unsupported) assert.ok(result.trace.some((item) => item.claim === text), text);
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.corrections, 1);
  assert.equal(result.mdx, undefined);
  const supported = await runFaqJudgment(claimPage, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada',
      evidenceIds: ['J1'], reason: '' })),
    judgeEditorial: async () => passing,
  });
  assert.equal(supported.status, 'aprovado');
  assert.match(supported.mdx, /description: "Robôs garantem clientes novos"/u);
  assert.ok(supported.trace.some(({ field, evidence }) => field === 'title' && evidence[0]?.id === 'J1'));
});

test('passo sem vínculo não contorna uma jornada bloqueada', async () => {
  const blocked = { id: 'robos.criar', modulo: 'robos', tarefa: 'Criar robô' };
  const plan = planFaqPage('robos', [blocked], [{ task: blocked.id, status: 'bloqueada' }]);
  const claimPage = { title: 'Robôs', sections: [
    { heading: 'Criar robô', taskId: blocked.id, units: [
      { text: 'O Menu de opções aparece na tela.', kind: 'contexto', evidenceIds: ['F1'] },
    ] },
    { heading: 'Passo a passo', taskId: null, units: [
      { text: 'Clique em Criar robô.', kind: 'passo', evidenceIds: ['F1'] },
    ] },
  ] };
  const result = await runFaqJudgment(claimPage,
    [{ id: 'F1', type: 'front', text: 'Menu de opções; Criar robô.' }], {
      judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada',
        evidenceIds: ['F1'], reason: '' })),
      judgeEditorial: async () => passing,
    }, { plan });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.ok(result.diagnostic.some((item) => /passo.*sem.*(?:tarefa|jornada|vínculo)/iu.test(item)));
  assert.deepEqual(plan.reviewTasks, [blocked.id]);
});

test('headings estruturais sem afirmação dispensam prova, promessa continua bloqueada', async () => {
  const structural = { title: 'Contatos', sections: [{ heading: 'O que é', units: [
    { text: 'O botão Salvar aparece na tela.', kind: 'contexto', evidenceIds: ['J1'] },
  ] }] };
  const providers = {
    judgeFacts: async (claims) => claims.map(({ id, field }) => ({ id, status: 'sustentada',
      evidenceIds: field.endsWith('.heading') ? [] : ['J1'], reason: '' })),
    judgeEditorial: async () => passing,
  };
  const accepted = await runFaqJudgment(structural, evidence, providers);
  assert.equal(accepted.status, 'aprovado');
  assert.ok(accepted.trace.some(({ field, evidence }) => field.endsWith('.heading') && evidence.length === 0));
  const deceptive = await runFaqJudgment({ ...structural, sections: [
    { ...structural.sections[0], heading: 'Contatos garantem vendas em dobro' },
  ] }, evidence, providers);
  assert.equal(deceptive.status, 'precisa de revisão humana');
});
