import test from 'node:test';
import assert from 'node:assert/strict';
import { planFaqPage, assembleFaqPage, runFaqJudgment } from './faq-generator-v2.mjs';

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
  assert.equal(verdict.trace.length, 2);
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
  assert.ok(invented.diagnostic.some((item) => item.includes('tarefa sem jornada virou passo')));
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
