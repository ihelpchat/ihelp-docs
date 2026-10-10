import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { areaPlans, areaWriteAllowed, nextAreaAction, verifyAreaResult } from './journey-plans/index.mjs';
import { journeyRequestAllowed } from './journey-runtime.mjs';

const catalog = JSON.parse(await readFile(new URL('../architecture/faq-regua/tarefas-ouro.json', import.meta.url)));
const matrix = JSON.parse(await readFile(new URL('../architecture/coverage-matrix.json', import.meta.url)));
const modules = ['crm', 'campanhas', 'agendamentos', 'tarefas'];
const request = (method, path, body) => ({ method: () => method, url: () => `https://api.example.test/api/v2${path}`,
  postData: () => body == null ? null : JSON.stringify(body), headers: () => ({ 'content-type': 'application/json' }) });
const context = (taskId) => ({ taskId, apiOrigin: 'https://api.example.test', generated: new Set(['Tarefa Exemplo 01', 'Nota Exemplo 01']),
  createdIds: new Set([11]), fixedIds: { card: new Set([7]), stage: new Set([4]) } });

test('cada área possui 4 a 8 tarefas, plano para permitidas e ponteiro na matriz', () => {
  for (const module of modules) {
    const tasks = catalog.tarefas.filter((item) => item.modulo === module);
    assert.ok(tasks.length >= 4 && tasks.length <= 8, module);
    assert.ok(tasks.every((item) => item.pontoDePartida && item.preRequisitos && item.resultadoEsperadoObservavel
      && item.acaoProibidaAoAgente));
    assert.ok(tasks.filter((item) => item.acaoProibidaAoAgente.startsWith('não')).every((item) => areaPlans[item.id]));
    assert.deepEqual(matrix.find((item) => item.module.toLowerCase() === module)?.tasks,
      tasks.map((item) => item.id));
  }
});

test('plano determinístico usa alvo presente e não conclui sem verificação persistida', () => {
  const screen = { controls: [{ role: 'button', name: 'Nova tarefa', enabled: true }], fields: [] };
  assert.deepEqual(nextAreaAction('tarefas.criar', screen, [], () => 'Tarefa Exemplo 01'),
    { type: 'click', role: 'button', name: 'Nova tarefa', value: null });
  assert.equal(nextAreaAction('tarefas.criar', { controls: [], fields: [] }, [], () => 'Tarefa Exemplo 01'), null);
  assert.equal(verifyAreaResult('tarefas.criar', { status: 200, body: [{ id: 11, title: 'Tarefa Exemplo 01' }] },
    { createdIds: new Set([11]), generated: new Set(['Tarefa Exemplo 01']) }), true);
  assert.equal(verifyAreaResult('tarefas.criar', { status: 200, body: [] },
    { createdIds: new Set([11]), generated: new Set(['Tarefa Exemplo 01']) }), false);
});

test('escritas reais do front aceitas só para fixture criada ou id opaco autorizado', () => {
  const cases = [
    ['tarefas.criar', 'POST', '/task', { title: 'Tarefa Exemplo 01', description: '', status: 1 }],
    ['tarefas.concluir', 'PATCH', '/task/11/status', { status: 3 }],
    ['tarefas.arquivar', 'POST', '/task/11/archive', { isArchived: true }],
    ['crm.adicionar_nota', 'POST', '/crm/card/7/notes', { cardId: 7, title: '', description: 'Nota Exemplo 01', isPrivate: false }],
    ['crm.mover_etapa', 'PUT', '/crm/card/7/stage/4', {}],
  ];
  for (const [taskId, method, path, body] of cases) {
    assert.equal(areaWriteAllowed(request(method, path, body), context(taskId)), true, taskId);
    assert.equal(journeyRequestAllowed(request(method, path, body), context(taskId)), true, `runtime: ${taskId}`);
  }
});

test('nega envio, disparo, publicação, agendamento real, ids alheios e valores externos', () => {
  const denied = [
    ['campanhas.disparar', 'POST', '/marketing', { status: 0 }],
    ['campanhas.agendar_envio', 'POST', '/marketing', { status: 0 }],
    ['campanhas.buscar', 'PUT', '/marketing/campaign-status/x/1', {}],
    ['agendamentos.criar_envio', 'POST', '/ScheduledMessages', { message: 'oi' }],
    ['tarefas.criar', 'POST', '/customers/send-message', { texto: 'oi' }],
    ['tarefas.concluir', 'PATCH', '/task/12/status', { status: 3 }],
    ['tarefas.criar', 'POST', '/task', { title: 'Tarefa externa', description: '', status: 1 }],
    ['crm.adicionar_nota', 'POST', '/crm/card/7/notes', { cardId: 7, title: '', description: 'texto externo', isPrivate: false }],
    ['crm.mover_etapa', 'PUT', '/crm/card/7/stage/99', {}],
  ];
  for (const [taskId, method, path, body] of denied)
    assert.equal(journeyRequestAllowed(request(method, path, body), context(taskId)), false, `${taskId} ${path}`);
});
