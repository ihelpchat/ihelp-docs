import test from 'node:test';
import assert from 'node:assert/strict';
import { planFaqPage, assembleFaqPage, runFaqJudgment } from './faq-generator-v2.mjs';

const task = { id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'cadastrar' };
const evidence = [{ id: 'J1', type: 'jornada', task: task.id, status: 'concluída', text: 'Salvar mostra o contato na lista.' }];
const page = { title: 'Contatos', sections: [
  { heading: 'O que é', units: [{ text: 'Contatos reúne os cadastros da equipe.', evidenceIds: ['J1'] }] },
  { heading: 'Adicionar contato', taskId: task.id, units: [{ text: 'Clique em Salvar e veja o contato na lista.', evidenceIds: ['J1'] }] },
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
  assert.equal((await runFaqJudgment({ ...page, sections: [{ heading: 'O que é', units: [{ text: 'Sem prova.', evidenceIds: [] }] }] }, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: [], reason: '' })),
    judgeEditorial: async () => passing,
  })).approved, false);
});

test('uma única correção; segunda reprovação vai para revisão humana', async () => {
  let writes = 0;
  const result = await runFaqJudgment(page, evidence, {
    judgeFacts: async (claims) => claims.map(({ id }) => ({ id, status: 'sustentada', evidenceIds: ['J1'], reason: '' })),
    judgeEditorial: async () => ({ ...passing, notas: { ...passing.notas, clareza: 2 }, aceite: false }),
    rewrite: async () => { writes++; return page; },
  });
  assert.equal(writes, 1);
  assert.equal(result.corrections, 1);
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.mdx, undefined);
});

test('tarefa sem jornada concluída não recebe passos nem resultado inventado', () => {
  const plan = planFaqPage('contatos', [task], [{ task: task.id, status: 'bloqueada' }]);
  assert.equal(plan.tasks[0].status, 'sem jornada');
  assert.deepEqual(plan.tasks[0].journeyEvidenceIds, []);
  assert.equal(plan.reviewTasks[0], task.id);
});
