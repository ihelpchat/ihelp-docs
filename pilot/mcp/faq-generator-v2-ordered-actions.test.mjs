import test from 'node:test';
import assert from 'node:assert/strict';
import * as generator from './faq-generator-v2.mjs';

// Forma sanitizada REAL registrada pela jornada robos.encaminhar (status concluída, 8 ações, 9 telas):
// o mesmo controle "Adicionar bloco (cabeçalho)" aparece em duas posições com propósitos diferentes
// (abrir a seleção de blocos; incluir o bloco configurado antes de Salvar). Nomes já sanitizados; sem valores.
// O registro não vincula tela a ação (journey-service observa sem agir e pode concluir sem observar), então a
// projeção não atribui controles de tela a uma ação: só sequência tipada, estado antes (1ª observação precede
// qualquer ação) e a última observação registrada, sem afirmar que ela é posterior à última ação.
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

test('projeção preserva a sequência sanitizada de ações com repetição, sem contexto de tela por ação', () => {
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

test('projeção separa o estado antes da primeira ação da última observação, sem afirmar fase', () => {
  const forwarded = product('robos.encaminhar');
  assert.deepEqual(forwarded.estadoVisivelAntes.mensagens, ['Inativo']);
  assert.deepEqual(forwarded.ultimaObservacao.mensagens, []);
  assert.deepEqual(forwarded.ultimaObservacao.controles, []);
  assert.equal(forwarded.estadoVisivelDepois, undefined, 'última tela não pode ser rotulada como depois');
  assert.ok(forwarded.mensagens.includes('Inativo'));
});

test('atalho de conclusão logo após agir: a última observação é anterior à última ação e não vira efeito', () => {
  // journey-service pode chamar complete(sanitized) com a observação feita ANTES do act recém-executado
  // (sem nova observação): 3 telas / 3 ações, after = state da tela 2. Nada aqui prova estado posterior a Salvar.
  const lastSeen = { ...state, headings: 'Contato' };
  const journey = { task: 'contatos.definir_responsavel', status: 'concluída',
    verification: { confirmed: true, observed: 'ok' }, before: state, after: lastSeen,
    actions: [click('button', 'Editar Proprietário do Contato'), click('option', 'opção 1'), click('button', 'Salvar')],
    screens: [screen([control('button', 'Editar Proprietário do Contato')]),
      screen([control('option', 'opção 1')], { messages: ['Rascunho'] }),
      { ...screen([control('button', 'Salvar')], { messages: ['Ainda não salvo'] }), state: lastSeen }] };
  const task = { id: 'contatos.definir_responsavel', modulo: 'contatos', tarefa: 'definir_responsavel' };
  const projected = JSON.parse(generator.projectFaqEvidence(generator.planFaqPage('contatos', [task], [journey]),
    [journey], { screenFacts: [] }, []).find((item) => item.id === 'J:contatos.definir_responsavel').text);
  assert.deepEqual(projected.acoes.map((action) => action.nome), ['Editar Proprietário do Contato', 'opção 1', 'Salvar']);
  assert.deepEqual(projected.estadoVisivelAntes.mensagens, ['Inativo']);
  assert.deepEqual(projected.ultimaObservacao, { titulos: ['Contato'], controles: ['Salvar'], mensagens: ['Ainda não salvo'] });
  assert.equal(projected.estadoVisivelDepois, undefined);
  assert.ok(!Object.keys(projected).some((key) => /depois/iu.test(key)), 'nenhuma chave afirma fase posterior');
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
  assert.doesNotMatch(instructions, /estadoVisivelDepois/u);
  assert.match(instructions, /ultimaObservacao[^.]*não garante que ela seja posterior à última ação/u);
  assert.match(instructions, /mesmo resultado confirmado pela conclusão estruturada/u);
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

test('contrato N1/N2/N3 chega ao redator junto com dados que distinguem tarefa concluída, contexto e valor anonimizado', () => {
  // Jornada concluída cuja escolha ficou anonimizada ("opção 1", sem value) e tarefa sem jornada na mesma pauta:
  // o redator recebe os dois estados e as regras que proíbem negar a seleção, detalhar operação sem jornada
  // e deixar o caso na necessidade. O teste valida o que é enviado; o comportamento do modelo só se mede em rodada real.
  const chosen = { task: 'robos.encaminhar', status: 'concluída', verification: { confirmed: true, observed: 'ok' },
    before: state, after: state,
    actions: [click('combobox', 'Encaminhar para um departamento ou atendente?'), click('option', 'opção 1'), click('button', 'Salvar')],
    screens: [screen([]), screen([]), screen([]), screen([], { messages: [] })] };
  const agenda = [{ id: 'robos.encaminhar', modulo: 'robos', tarefa: 'encaminhar' },
    { id: 'robos.publicar_ativar', modulo: 'robos', tarefa: 'publicar_ativar' }];
  const scoped = generator.planFaqPage('robos', agenda, [chosen]);
  const sent = JSON.parse(generator.faqWriterInput(scoped, agenda,
    generator.projectFaqEvidence(scoped, [chosen], { screenFacts: [] }, []), []));
  assert.deepEqual(sent.plan.tasks.map(({ id, status }) => [id, status]),
    [['robos.encaminhar', 'concluída'], ['robos.publicar_ativar', 'sem jornada']]);
  const journey = JSON.parse(sent.evidence.find((item) => item.id === 'J:robos.encaminhar').text);
  assert.deepEqual(journey.acoes.map((action) => action.nome),
    ['Encaminhar para um departamento ou atendente?', 'opção 1', 'Salvar'], 'valor anonimizado chega como nome, sem value');
  assert.doesNotMatch(JSON.stringify(sent), /"value"/u);
  const instructions = generator.faqWriterInstructions([]);
  const sentences = instructions.split(/(?<=\.)\s+/u);
  const rule = (...patterns) => sentences.some((sentence) => patterns.every((pattern) => pattern.test(sentence)));
  assert.ok(rule(/ausência de um valor/u, /não prova/u, /não negue/u, /valor oculto/u, /conclusão estruturada/u), 'N1');
  assert.ok(rule(/sem jornada/u, /critérios de busca/u, /modo de operação/u, /pré-requisitos/u), 'N2');
  assert.ok(rule(/caso concreto/u, /recurso escolhido/u, /sem ação na tela/u, /evite repetir/u, /Para que serve/u), 'N3');
  // Barreiras anteriores permanecem no mesmo texto.
  assert.ok(rule(/sem jornada/u, /sem passo ou efeito/u));
  assert.ok(rule(/ação ausente de acoes/u));
});
