import test from 'node:test';
import assert from 'node:assert/strict';
import * as generator from './faq-generator-v2.mjs';

// Forma sanitizada REAL registrada pela jornada robos.encaminhar (status concluída, 8 ações, 9 telas):
// o mesmo controle "Adicionar bloco (cabeçalho)" aparece em duas posições com propósitos diferentes
// (abrir a seleção de blocos; incluir o bloco configurado antes de Salvar). Nomes já sanitizados; sem valores.
// O registro não vincula tela a ação (journey-service observa sem agir e pode concluir sem observar), então a
// projeção não atribui controles de tela a uma ação: só sequência tipada, estado antes e estado depois.
const click = (role, name) => ({ type: 'click', role, name, value: null });
const control = (role, name) => ({ role, name, enabled: true, checked: false });
const hidden = '[conteúdo oculto]';
const state = { headings: hidden, visibleRows: '0', generatedRows: '0' };
const screen = (controlsOffered, { messages = ['Inativo'], fields = [] } = {}) =>
  ({ title: 'Robôs', path: '/bot/record', controlsOffered, fields, messages, state });
const forwardingActions = [
  click('link', 'Fluxo de Robô'),
  click('button', 'Adicionar bloco (cabeçalho)'),
  click('button', 'Ação'),
  click('button', 'Encaminhar atendimento'),
  click('combobox', 'Encaminhar para um departamento ou atendente?'),
  click('option', 'opção 1'),
  click('button', 'Adicionar bloco (cabeçalho)'),
  click('button', 'Salvar'),
];
const targetFields = ['campo 1 do formulário (texto)', 'campo 2 do formulário (texto)',
  'Encaminhar para um departamento ou atendente?', 'campo 4 do formulário (seleção)']
  .map((name) => ({ role: 'textbox', name, required: false, filled: false, value: null }));
const forwardingScreens = [
  screen(['Voltar para lista', 'Editar título do Robô', 'Salvar', 'Publicar', 'Fluxo de Robô', 'Contatos',
    'Configurações', 'campo 1 do formulário (seleção)', 'Open options (cabeçalho)', 'Open options (cabeçalho 2)',
    'Adicionar bloco (cabeçalho)', 'Open options (cabeçalho 3)', 'Adicionar bloco (cabeçalho 2)'].map((name) => control('button', name))),
  screen([]),
  screen([control('button', 'Robô Exemplo 01 · 3493c4eb'), control('button', 'Mensagem simples'),
    control('button', 'Menu de opções'), control('button', 'Ação'), control('button', 'Adicionar bloco (cabeçalho 3)')]),
  screen(['Ações', 'Encaminhar atendimento', 'Definir como prioridade', 'Finalizar atendimento', 'Requisição HTTP',
    'Recomeçar atendimento'].map((name) => control('button', name))),
  screen([control('textbox', 'campo 1 do formulário (texto)'), control('textbox', 'campo 2 do formulário (texto)'),
    control('combobox', 'Encaminhar para um departamento ou atendente?'),
    control('button', 'Encaminhar para um departamento ou atendente? (cabeçalho)'),
    control('button', 'Encaminhar para um departamento ou atendente? (cabeçalho 2)'),
    control('combobox', 'campo 4 do formulário (seleção)')], { fields: targetFields }),
  screen([control('textbox', 'Robô Exemplo 01 · 3493c4eb'),
    ...Array.from({ length: 19 }, (_, index) => control('option', `opção ${index + 1}`))], { fields: targetFields }),
  screen([], { fields: targetFields }),
  screen([control('combobox', 'campo 1 do formulário (seleção)'), control('button', 'Adicionar bloco'),
    control('button', 'Open options (cabeçalho 4)')]),
  screen([], { messages: [] }),
];
const forwarding = { task: 'robos.encaminhar', status: 'concluída',
  verification: { confirmed: true, observed: 'Ficha única reaberta com valor esperado' },
  before: state, after: state, actions: forwardingActions, screens: forwardingScreens };
const menu = { task: 'robos.montar_menu', status: 'concluída', verification: { confirmed: true, observed: 'ok' },
  before: state, after: state,
  actions: [click('link', 'Fluxo de Robô'), { type: 'fill', role: 'textbox', name: 'Mensagem', value: 'segredo-fixture' },
    click('button', hidden), click('button', 'Salvar')],
  screens: [screen([control('link', 'Fluxo de Robô')]), screen([control('textbox', 'Mensagem')]),
    screen([control('button', hidden)]), screen([control('button', 'Salvar')]), screen([], { messages: [] })] };
const tasks = [{ id: 'robos.encaminhar', modulo: 'robos', tarefa: 'encaminhar' },
  { id: 'robos.montar_menu', modulo: 'robos', tarefa: 'montar_menu' }];
const plan = generator.planFaqPage('robos', tasks, [forwarding, menu]);
const evidence = generator.projectFaqEvidence(plan, [forwarding, menu], { screenFacts: [] }, []);
const product = (taskId) => JSON.parse(evidence.find((item) => item.id === `J:${taskId}`).text);
const prompt = generator.faqWriterInput(plan, tasks, evidence, []);

test('projeção preserva a sequência sanitizada de ações com repetição e o contexto de cada ação', () => {
  assert.equal(plan.tasks[0].status, 'concluída');
  const sequence = product('robos.encaminhar').acoes;
  assert.deepEqual(sequence.map((action) => action.nome), forwardingActions.map(({ name }) => name),
    'sequência observada com repetição perdida pela projeção');
  assert.deepEqual(sequence.map((action) => [action.tipo, action.papel]).slice(4, 6),
    [['click', 'combobox'], ['click', 'option']]);
  // Sem vínculo temporal comprovado entre tela e ação, nenhuma ação recebe controles de tela.
  for (const action of sequence) {
    assert.deepEqual(Object.keys(action).sort(), ['nome', 'papel', 'tipo'], `só sequência tipada: ${action.nome}`);
  }
});

test('projeção separa o estado visível antes da primeira ação do estado depois da última', () => {
  const forwarded = product('robos.encaminhar');
  assert.deepEqual(forwarded.estadoVisivelAntes.mensagens, ['Inativo']);
  assert.deepEqual(forwarded.estadoVisivelDepois.mensagens, []);
  assert.deepEqual(forwarded.estadoVisivelDepois.controles, []);
  assert.ok(forwarded.mensagens.includes('Inativo'));
});

test('projeção mantém filtros de privacidade e o esquema público da evidência', () => {
  const projected = product('robos.montar_menu');
  assert.deepEqual(projected.acoes.map((action) => action.nome), ['Fluxo de Robô', 'Mensagem', 'Salvar']);
  assert.doesNotMatch(prompt, /segredo-fixture|"value"|generatedRows|visibleRows|screenshotId|Ficha única|conteúdo oculto/u);
  assert.match(prompt, /"concluida":true/u);
  for (const item of JSON.parse(prompt).evidence) {
    assert.ok(Object.keys(item).every((key) => ['id', 'type', 'task', 'status', 'text', 'concluida'].includes(key)), key(item));
  }
  function key(item) { return `chave inesperada em ${item.id}: ${Object.keys(item).join(',')}`; }
});

test('instruções do redator: efeito condicionado ao estado inicial, sem fecho repetido, sem ação inventada', () => {
  const instructions = generator.faqWriterInstructions([]);
  assert.match(instructions, /estadoVisivelAntes[^.]*não é efeito da tarefa/u);
  assert.match(instructions, /mesmo controle aparece mais de uma vez/u);
  assert.doesNotMatch(instructions, /controlesDepois/u);
  assert.match(instructions, /não atribua a uma ação o que a tela mostrou em outro momento/u);
  assert.match(instructions, /\(cabeçalho\)[^.]*não é rótulo nem posição real/u);
  assert.match(instructions, /parênteses que fazem parte do texto do produto permanecem/u);
  assert.match(instructions, /efeito completo uma vez/u);
  assert.match(instructions, /ação ausente de acoes/u);
  assert.match(instructions, /estadoVisivelDepois estiver vazio[^.]*não foi observado/u);
  assert.match(instructions, /observado e não vazio/u);
  assert.match(instructions, /cada tarefa concluída.*resultado/isu);
});

test('observação extra sem ação e conclusão imediata não atribuem controles de tela a outra ação', () => {
  // screen0 → ação0; screen1 = observação de feedback sem ação; screen2 → ação1; screen3 → ação2; conclusão
  // imediata sem observação final. Cardinalidade n+1 (4 telas, 3 ações) sem alinhamento tela→ação.
  const journey = { task: 'robos.salvar', status: 'concluída', verification: { confirmed: true, observed: 'ok' },
    before: state, after: state,
    actions: [click('link', 'Fluxo de Robô'), click('button', 'Adicionar bloco'), click('button', 'Salvar')],
    screens: [screen([control('link', 'Fluxo de Robô')]), screen([control('button', 'Somente feedback')]),
      screen([control('button', 'Menu de opções')]), screen([control('button', 'Salvar')])] };
  const task = { id: 'robos.salvar', modulo: 'robos', tarefa: 'salvar' };
  const projected = JSON.parse(generator.projectFaqEvidence(generator.planFaqPage('robos', [task], [journey]),
    [journey], { screenFacts: [] }, []).find((item) => item.id === 'J:robos.salvar').text);
  assert.deepEqual(projected.acoes, [
    { tipo: 'click', papel: 'link', nome: 'Fluxo de Robô' },
    { tipo: 'click', papel: 'button', nome: 'Adicionar bloco' },
    { tipo: 'click', papel: 'button', nome: 'Salvar' },
  ]);
  assert.doesNotMatch(JSON.stringify(projected.acoes), /Somente feedback|Menu de opções|controlesDepois/u,
    'controle de outra observação atribuído a uma ação');
  assert.deepEqual(projected.estadoVisivelAntes.mensagens, ['Inativo']);
});
