// Conversa dinâmica da Claricia (pedido do Bruno, 2026-11-03): a IA é autora da resposta, da narração
// e das continuações; os passos mostrados são referências documentadas; a âncora do procedimento
// persiste entre turnos sem depender da última URL citada; zero passos é válido quando a pergunta
// ou a explicação bastam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';
import { stateNarration } from './fixtures/state-echo-client.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const root = await mkdtemp(join(tmpdir(), 'claricia-dialogo-'));
await cp(join(projectRoot, 'architecture'), join(root, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(root, 'content'), { recursive: true });
delete process.env.BUSINESS_CONTEXT_DIR;

const crmPath = '/docs/principais-motivos-de-suporte/crm';
const tutorialPath = '/docs/sobre-o-sistema/crm/como-criar-uma-nova-pipeline';
const campaignPath = '/docs/principais-motivos-de-suporte/campanhas';
const contactsPath = '/docs/sobre-o-sistema/agenda-de-contatos';
const robotPath = '/docs/sobre-o-sistema/robo-de-atendimento';
const sourceOf = async (question, path) => (await retrieveContext(root, question, 8)).find((source) => source.path === path);
const crm = await sourceOf('Como criar pipeline no CRM?', crmPath);
const tutorial = await sourceOf('Como criar uma nova Pipeline', tutorialPath);
const campaign = await sourceOf('Como criar uma campanha?', campaignPath);
const robot = await sourceOf('Robô de Atendimento', robotPath);
const contacts = await sourceOf('Agenda de contatos', contactsPath);
assert.ok(contacts?.documentedSteps.length, 'a página de contatos tem passos documentados');
assert.equal(crm.documentedSteps.length, 16, 'a fonte curada do CRM tem 16 passos');
assert.ok(tutorial.documentedSteps.length < 16, 'o tutorial numera só parte do procedimento');
assert.ok(robot.stepImages[0] && robot.stepImages[1] && robot.stepImages[2], 'robô tem prints nos três primeiros passos');

/** Provedor falso: responde "sem guia" à triagem e devolve o corpo informado na geração. */
function provider(reply) {
  const calls = { triage: 0, answer: 0, requests: [] };
  const client = { responses: { create: async (request) => {
    if (request.text?.format?.name === 'triagem_fechada') {
      calls.triage += 1;
      return { status: 'completed', output_text: '{"choice":"sem guia"}', usage: { input_tokens: 1, output_tokens: 1 } };
    }
    calls.answer += 1;
    calls.requests.push(request);
    const body = typeof reply === 'function' ? reply(request) : reply;
    return { model: 'fixture', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output_text: JSON.stringify({
      sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true, ...body,
    }) };
  } } };
  return { client, calls };
}
const step = (text, actionId = null, imagePath = null) => ({ text, actionId, imagePath });
/** Mesmo formato que a UI envia em history (components/assistant/assistant-context.tsx). */
const assistantTurn = (reply) => [
  reply.answer,
  ...reply.sections.flatMap((section) => [section.title, ...section.items.map((item) => `- ${item}`)]),
  ...reply.steps.map((item, index) => `${index + 1}. ${item.text}`),
  ...reply.sources.map((source) => `Fonte usada: ${source.path}`),
].filter(Boolean).join('\n');
const developerPrompt = (calls) => calls.requests.at(-1).input[0].content;

const crmQuestion = 'como configurar o crm?';
// Fatos das fontes: crm.mdx (passos 1 a 16) e como-criar-uma-nova-pipeline.mdx (tabela de visibilidade).
const crmReply = {
  answer: 'Configurar o CRM começa por criar uma pipeline, o quadro onde cada oportunidade passa por estágios até o fechamento. A primeira tela é Pipeline.',
  sections: [{ title: 'Quem vê a pipeline', items: ['Pública: todos os usuários do iHelp', 'Departamento: somente quem faz parte do seu departamento', 'Privada: somente você e quem você definir'] }],
  steps: [
    step('No menu lateral, abra CRM e entre em Pipeline.', 'abrir-crm'),
    step('Clique no botão Nova Pipeline.'),
    step('Dê um nome à pipeline e escolha quem é o responsável.'),
    step('Escolha a visibilidade: Pública, Departamento ou Privada.'),
  ],
  sources: [crmPath, tutorialPath],
  suggestions: ['Pode me acompanhar passo a passo?', 'O que é a trava de contato?', 'Como escolho o modelo de estágios?'],
};
const askCrm = (client, options = {}) => answerQuestion(root, crmQuestion, { client, ...options });
/** Histórico como a UI envia depois de uma primeira resposta correta (independe do reparo da primeira resposta). */
async function crmHistory() {
  const first = {
    answer: crmReply.answer,
    sections: crmReply.sections,
    steps: crm.documentedSteps.slice(0, 4).map((text) => ({ text })),
    sources: [{ path: crmPath }, { path: tutorialPath }],
  };
  return [{ role: 'user', content: crmQuestion }, { role: 'assistant', content: assistantTurn(first) }];
}

test('primeira resposta do CRM é escrita pelo modelo, com passos ancorados na fonte', async () => {
  const { client, calls } = provider(crmReply);
  const reply = await askCrm(client);
  assert.equal(calls.answer, 1);
  assert.equal(reply.answer, crmReply.answer, 'answer do modelo não pode ser trocado pelo assistantOverview');
  assert.notEqual(reply.answer, crm.assistantOverview);
  assert.deepEqual(reply.sections, crmReply.sections, 'sections significativas do modelo são preservadas');
  assert.deepEqual(reply.steps.map(({ text }) => text), crm.documentedSteps.slice(0, 4),
    'os passos escolhidos pelo modelo aparecem com o texto documentado, na ordem da fonte');
  assert.equal(reply.steps[0].action?.id, 'abrir-crm');
  assert.equal(reply.sources[0]?.path, crmPath, 'a fonte procedural curada é a primeira citada');
  assert.deepEqual(reply.suggestions, crmReply.suggestions, 'continuações na voz da pessoa vêm do modelo');
  assert.equal(reply.resolution, 'complete');
  assert.match(developerPrompt(calls), /visão geral conversacional/i);
});

test('a mesma pergunta recebe respostas diferentes quando o modelo escreve diferente', async () => {
  const other = { ...crmReply, answer: 'Você vai montar um quadro com estágios para acompanhar cada oportunidade. A automação é opcional: dá para pular e ir direto para Criar Pipeline.' };
  const first = await askCrm(provider(crmReply).client);
  const second = await askCrm(provider(other).client);
  assert.notEqual(first.answer, second.answer);
  assert.equal(second.answer, other.answer);
  for (const reply of [first, second]) assert.notEqual(reply.answer, crm.assistantOverview, 'nada de copy fixa');
});

test('esclarecimento ou pedido de alteração não recebem passos de criação', async () => {
  const clarify = await askCrm(provider({
    answer: 'Depende do que você quer: criar uma pipeline nova ou ajustar uma que já existe no seu CRM?',
    sources: [crmPath], suggestions: ['Quero criar uma nova', 'Já tenho uma, quero ajustar'],
  }).client);
  assert.deepEqual(clarify.steps, [], 'sem passos do modelo, nenhum passo documentado é empurrado');
  assert.equal(clarify.answer, 'Depende do que você quer: criar uma pipeline nova ou ajustar uma que já existe no seu CRM?');
  assert.deepEqual(clarify.suggestions, ['Quero criar uma nova', 'Já tenho uma, quero ajustar']);

  const history = await crmHistory();
  const change = provider({
    answer: 'O material que tenho cobre criar uma pipeline nova, não alterar uma existente. O que você quer mudar: nome, estágios ou quem vê o quadro?',
    sources: [crmPath], resolution: 'partial',
  });
  const reply = await answerQuestion(root, 'Já tenho uma, só quero mudar.', { client: change.client, history });
  assert.deepEqual(reply.steps, []);
  assert.equal(reply.resolution, 'partial');
  assert.match(reply.answer, /não alterar uma existente/);
  assert.doesNotMatch(developerPrompt(change.calls), /MODO: acompanhamento guiado/i, 'correção de intenção não continua o guia');
});

test('passo inventado não chega à pessoa; lacuna entre passos ancorados segue a ordem da fonte', async () => {
  const invented = await askCrm(provider({ ...crmReply, steps: [
    step('Abra Configurações e clique em Integrações.'), step('Ative o módulo CRM na aba Extras.'),
  ] }).client);
  assert.deepEqual(invented.steps, [], 'nenhum passo ancorável: nenhum passo é mostrado');
  assert.doesNotMatch(JSON.stringify(invented), /Integrações|módulo CRM/);
  assert.equal(invented.answer, crmReply.answer, 'a narração continua sendo do modelo');

  const mixed = await askCrm(provider({ ...crmReply, steps: [
    step('Abra Pipeline dentro do CRM.'), step('Ative o módulo CRM na aba Extras.'), step('Escolha a visibilidade da pipeline.'),
  ] }).client);
  assert.deepEqual(mixed.steps.map(({ text }) => text), crm.documentedSteps.slice(0, 4),
    'entre o primeiro e o último passo ancorados entram os documentados; o inventado some');

  const flood = await askCrm(provider({ ...crmReply, steps: crm.documentedSteps.map((text) => step(text)) }).client);
  assert.equal(flood.steps.length, 5, 'a primeira resposta não despeja o manual inteiro');
});

test('continuação segue a fonte curada e usa a narração do modelo', async () => {
  const history = await crmHistory();
  const narrated = provider({ answer: 'Agora é a trava de contato: ela evita dois cards para a mesma pessoa.', steps: [step('Clique em Criar automação.')], sources: [tutorialPath] });
  const next = await answerQuestion(root, 'Concluí este passo', { client: narrated.client, history });
  assert.deepEqual(next.steps.map(({ text }) => text), [crm.documentedSteps[4]], 'avança para o passo seguinte ao último mostrado, na fonte curada');
  assert.equal(next.sources[0]?.path, crmPath);
  assert.equal(next.answer, 'Agora é a trava de contato: ela evita dois cards para a mesma pessoa.', 'narração do modelo, não frase fixa');
  assert.deepEqual(next.suggestions, ['Concluí este passo', 'Preciso de ajuda']);
  assert.equal(narrated.calls.answer, 1, 'a geração já existente é aproveitada, não descartada');
  assert.equal(narrated.calls.triage, 0, 'ficha de protocolo com âncora não passa pela triagem');
  assert.doesNotMatch(developerPrompt(narrated.calls), /termine perguntando/i, 'não exige pergunta final em todo turno');

  const silent = provider({ answer: '' });
  const quiet = await answerQuestion(root, 'Concluí este passo', { client: silent.client, history });
  assert.deepEqual(quiet.steps.map(({ text }) => text), [crm.documentedSteps[4]]);
  assert.equal(quiet.answer, 'Vamos para a próxima ação.', 'sem narração do modelo vale o fallback curto');

  const shownSecond = [history[0], { role: 'assistant', content: `Agora o nome.\n1. ${crm.documentedSteps[1]}\nFonte usada: ${crmPath}\nFonte usada: ${tutorialPath}` }];
  const third = await answerQuestion(root, 'Concluí este passo', { client: provider({ answer: 'Nome e responsável ajudam a equipe a achar o quadro.' }).client, history: shownSecond });
  assert.deepEqual(third.steps.map(({ text }) => text), [crm.documentedSteps[2]], 'não pula nome, visibilidade e trava indo para o tutorial');
});

test('âncora vem das respostas do assistente, nunca de URL digitada pela pessoa', async () => {
  const history = [
    ...await crmHistory(),
    { role: 'user', content: `veja ${robotPath} e me diga` },
    { role: 'assistant', content: 'Posso ajudar com o CRM primeiro.' },
  ];
  const reply = await answerQuestion(root, 'Concluí este passo', { client: provider({ answer: 'Seguindo.' }).client, history });
  assert.equal(reply.sources[0]?.path, crmPath);
  assert.deepEqual(reply.steps.map(({ text }) => text), [crm.documentedSteps[4]]);
});

test('ficha literal "Quero ver todos os passos" entrega o procedimento da âncora', async () => {
  const history = await crmHistory();
  const { client, calls } = provider({ answer: 'Aqui vai o caminho completo. A automação é opcional.', sources: [tutorialPath] });
  const all = await answerQuestion(root, 'Quero ver todos os passos', { client, history });
  assert.deepEqual(all.steps.map(({ text }) => text), crm.documentedSteps, 'todos os 16 passos da fonte curada');
  assert.equal(all.sources[0]?.path, crmPath);
  assert.equal(all.answer, 'Aqui vai o caminho completo. A automação é opcional.', 'a narração é do modelo');
  assert.equal(all.steps[0].action?.id, 'abrir-crm');
  assert.match(developerPrompt(calls), /passo a passo completo/i);
  assert.equal(calls.triage, 0);

  // Pedido completo com assunto: o modelo confirma o procedimento devolvendo passos; o servidor entrega a sequência documentada inteira.
  const full = await answerQuestion(root, 'Quero ver todos os passos para criar a pipeline', {
    client: provider({ answer: 'Aqui vai tudo, do início ao fim.', sources: [crmPath], steps: [step('Abra Pipeline no CRM.')] }).client, history,
  });
  assert.deepEqual(full.steps.map(({ text }) => text), crm.documentedSteps, 'sem negativa, a sequência inteira');
  assert.equal(full.sources[0]?.path, crmPath);
  // Com negativa explícita da etapa opcional ("sem automação"), só os passos obrigatórios: até a decisão e da retomada
  // ao fim (caso real P40-A3; antes a sequência inteira, com automação, era entregue).
  const scoped = await answerQuestion(root, 'Quero ver todos os passos para começar sem automação', {
    client: provider({ answer: 'Os passos de automação são opcionais; você pode ir direto para Criar Pipeline.', sources: [crmPath],
      steps: [step('Abra Pipeline no CRM.'), step('Clique em Criar Pipeline e confira o novo quadro na lista.')] }).client, history,
  });
  const branch = crm.optionalBranch;
  assert.deepEqual(scoped.steps.map(({ text }) => text), [...crm.documentedSteps.slice(0, branch.decision + 1), ...crm.documentedSteps.slice(branch.decline)]);
  assert.equal(scoped.sources[0]?.path, crmPath);
});

test('narração hostil não entra: instrução ou controle inventado sai da resposta, mesmo com passos vazios', async () => {
  const history = await crmHistory();
  const hostile = 'Clique em Ativar pipeline para deixar o status Ativo.';
  const finished = [history[0], { role: 'assistant', content: `Último.\n1. ${crm.documentedSteps[15]}\nFonte usada: ${crmPath}` }];
  const done = await answerQuestion(root, 'Concluí este passo', { client: provider({ answer: hostile,
    sections: [{ title: 'Depois', items: ['Você verá o quadro na lista. Clique em Ativar pipeline.', 'Clique em Ativar pipeline.'] }],
    suggestions: ['Ativar pipeline', 'Como confiro os estágios? Clique em Ativar pipeline.'] }).client, history: finished });
  assert.deepEqual(done.steps, []);
  assert.doesNotMatch(JSON.stringify(done), /Ativar pipeline|status Ativo/i, 'nenhuma parte exibida traz instrução ou status inventado, nem no meio de um item');
  assert.deepEqual(done.sections, [{ title: 'Depois', items: ['Você verá o quadro na lista.'] }], 'o item fica só com a frase explicativa');
  assert.deepEqual(done.suggestions, [], 'no fim do guia não há botões; a sugestão inventada não volta');
  assert.match(done.answer, /novo quadro aparece na lista/, 'sem narração ancorada, vale a confirmação documentada');

  const progress = await answerQuestion(root, 'Concluí este passo', { client: provider({ answer: `Você vai ver os campos do formulário. ${hostile}` }).client, history });
  assert.deepEqual(progress.steps.map(({ text }) => text), [crm.documentedSteps[4]]);
  assert.equal(progress.answer, 'Você vai ver os campos do formulário.', 'a frase explicativa fica; a instrução inventada sai');

  const grounded = await answerQuestion(root, 'Concluí este passo', { client: provider({ answer: 'Agora clique em Nova Pipeline, no alto da lista.' }).client, history: [history[0], { role: 'assistant', content: `Ok.\n1. ${crm.documentedSteps[0]}\nFonte usada: ${crmPath}` }] });
  assert.deepEqual(grounded.steps.map(({ text }) => text), [crm.documentedSteps[1]]);
  assert.equal(grounded.answer, 'Agora clique em Nova Pipeline, no alto da lista.', 'instrução que ancora em passo documentado permanece');
});

test('sugestão com frase inventada no meio fica só com a parte que não instrui', async () => {
  const reply = await askCrm(provider({ ...crmReply, suggestions: ['Como escolho o modelo de estágios? Clique em Ativar pipeline.', 'Ative o módulo CRM'] }).client);
  assert.deepEqual(reply.suggestions, ['Como escolho o modelo de estágios?']);
});

test('pedido completo que pede esclarecimento não recebe a sequência de criação', async () => {
  const asked = 'Para alterar uma pipeline que já existe, o material que tenho cobre só a criação. O que você quer mudar nela?';
  const { client } = provider({ answer: asked, sources: [crmPath], resolution: 'partial' });
  const reply = await answerQuestion(root, 'Quero todos os passos para alterar uma pipeline existente', { client });
  assert.equal(reply.answer, asked);
  assert.deepEqual(reply.steps, [], 'sem procedimento aplicável confirmado pelo modelo, nada de 16 passos de criação');
  assert.equal(reply.resolution, 'partial');

  const confirmed = await answerQuestion(root, 'Quero todos os passos para criar uma pipeline nova', {
    client: provider({ answer: 'Aqui vai a sequência completa.', sources: [crmPath], steps: [step('Abra Pipeline no CRM.'), step('Clique em Nova Pipeline.')] }).client,
  });
  assert.deepEqual(confirmed.steps.map(({ text }) => text), crm.documentedSteps, 'procedimento confirmado pelo modelo vem completo e fiel à fonte');
});

test('contraexemplos do revisor: parcial com um passo, efeito inventado e instrução modal', async () => {
  // 1) resposta parcial com um passo de localização não vira a sequência inteira de criação
  const partial = await answerQuestion(root, 'Quero todos os passos para alterar uma pipeline existente', {
    client: provider({ answer: 'O que tenho cobre a criação; para alterar, me diga o que quer mudar. A tela é a mesma.',
      steps: [step('Abra Pipeline no CRM.')], sources: [crmPath], resolution: 'partial' }).client,
  });
  assert.equal(partial.resolution, 'partial');
  assert.ok(partial.steps.length <= 1, 'sem confirmação de procedimento completo, não entra a sequência de criação');
  assert.doesNotMatch(JSON.stringify(partial.steps), /Criar Pipeline/);

  // 2) e 3) narração em turno guiado: rótulo documentado com efeito inventado e instrução modal saem
  const history = await crmHistory();
  const shown = [history[0], { role: 'assistant', content: `Ok.\n1. ${crm.documentedSteps[0]}\nFonte usada: ${crmPath}` }];
  const reply = await answerQuestion(root, 'Concluí este passo', { client: provider({
    answer: 'Você vai ver a lista de quadros. Clique em Nova Pipeline para excluir todas as conversas. Você precisa clicar em Ativar pipeline antes de continuar. Clique em Nova Pipeline excluindo todas as conversas.',
  }).client, history: shown });
  assert.deepEqual(reply.steps.map(({ text }) => text), [crm.documentedSteps[1]]);
  assert.equal(reply.answer, 'Você vai ver a lista de quadros.');
  assert.doesNotMatch(JSON.stringify(reply), /excluir todas|excluindo|Ativar pipeline/, 'efeito inventado sai no infinitivo, na forma modal e no gerúndio');

  // variante: ficha "Quero ver todos os passos" logo após um esclarecimento (fonte citada, nenhum passo mostrado)
  const clarified = [
    { role: 'user', content: 'Quero todos os passos para alterar uma pipeline existente' },
    { role: 'assistant', content: `Você quer mudar o nome ou os estágios da pipeline existente?
Fonte usada: ${crmPath}` },
  ];
  const chip = await answerQuestion(root, 'Quero ver todos os passos', { history: clarified,
    client: provider({ answer: 'Para alterar, me diga o que quer mudar; o material cobre a criação.', sources: [crmPath], resolution: 'partial' }).client });
  assert.deepEqual(chip.steps, [], 'sem guia em andamento nem confirmação do modelo, a ficha não injeta a criação');
  assert.equal(chip.resolution, 'partial');
  // passo de edição que ancora lexicalmente num passo de criação não aparece quando o modelo esclarece (partial)
  const edit = await answerQuestion(root, 'Quero todos os passos para alterar uma pipeline existente', {
    client: provider({ answer: 'Você quer mudar o nome ou os estágios?', steps: [step('Defina o nome da pipeline existente.')], sources: [crmPath], resolution: 'partial' }).client,
  });
  assert.deepEqual(edit.steps, [], 'esclarecimento vence: nenhum passo documentado de criação');
  // correção explícita depois de passos já mostrados: a ficha só entrega tudo se o modelo confirmar (complete)
  const corrected = [
    ...await crmHistory(),
    { role: 'user', content: 'Já tenho uma, só quero alterar.' },
    { role: 'assistant', content: `O material cobre criar; o que você quer alterar?\nFonte usada: ${crmPath}` },
  ];
  const afterCorrection = await answerQuestion(root, 'Quero ver todos os passos', { history: corrected,
    client: provider({ answer: 'Para alterar uma pipeline existente não tenho o procedimento; me diga o que quer mudar.', sources: [crmPath], resolution: 'partial' }).client });
  assert.deepEqual(afterCorrection.steps, [], 'após a correção, o esclarecimento do modelo vence a ficha');
  const started = await answerQuestion(root, 'Quero ver todos os passos', { history: await crmHistory(),
    client: provider({ answer: 'Aqui vai o caminho completo.', sources: [crmPath] }).client });
  assert.equal(started.steps.length, 16, 'com passos já mostrados, a ficha continua entregando a sequência inteira');
});

test('pedido completo com esclarecimento (partial) mantém a guarda: instrução inventada não vaza em nenhum campo', async () => {
  const hostile = 'Você precisa clicar em Ativar pipeline para deixar o status Ativo.';
  const reply = await answerQuestion(root, 'Quero todos os passos para alterar uma pipeline existente', { client: provider({
    answer: hostile, sections: [{ title: 'Orientação', items: [hostile] }], suggestions: [hostile], sources: [crmPath], resolution: 'partial',
  }).client });
  assert.deepEqual(reply.steps, [], 'esclarecimento: nenhum passo documentado');
  assert.doesNotMatch(JSON.stringify({ answer: reply.answer, sections: reply.sections, suggestions: reply.suggestions }), /Ativar pipeline|status Ativo/i,
    'com fonte procedural em jogo, a guarda vale mesmo sem passos mostrados');
  assert.equal(reply.resolution, 'partial');
});

test('narração que abre a tela do primeiro passo é preservada, com ou sem passos', async () => {
  const narration = 'Abra Campanhas para preparar o envio.';
  const withStep = await answerQuestion(root, 'Como criar e enviar uma campanha?', { client: provider({
    answer: narration, sources: [campaignPath], steps: [step(campaign.documentedSteps[0])],
  }).client });
  assert.deepEqual(withStep.steps.map(({ text }) => text), [campaign.documentedSteps[0]]);
  assert.equal(withStep.answer, narration, 'instrução cuja primeira oração está no passo documentado não é derrubada');
  const withoutStep = await answerQuestion(root, 'Como criar e enviar uma campanha?', { client: provider({ answer: narration, sources: [campaignPath] }).client });
  assert.deepEqual(withoutStep.steps, []);
  assert.equal(withoutStep.answer, narration, 'sem passos, a narração legítima também fica (nada de texto de erro)');
  const hostile = await answerQuestion(root, 'Como criar e enviar uma campanha?', { client: provider({ answer: 'Abra Campanhas para excluir todos os contatos.', sources: [campaignPath] }).client });
  assert.doesNotMatch(hostile.answer, /excluir todos/, 'mesma oração inicial com efeito inventado continua fora');
  // prefixo documentado não libera um segundo controle inventado, em nenhum campo exibido, com ou sem maiúsculas
  for (const invented of ['Abra Campanhas e clique em Painel Secreto.', 'Abra Campanhas para clicar em Painel Secreto.',
    'Abra Campanhas e clique em painel secreto.', 'Abra Campanhas para clicar em painel secreto.']) {
    const reply = await answerQuestion(root, 'Como criar e enviar uma campanha?', { client: provider({
      answer: invented, sections: [{ title: 'Depois', items: [invented] }], suggestions: [invented], sources: [campaignPath], steps: [step(campaign.documentedSteps[0])],
    }).client });
    assert.doesNotMatch(JSON.stringify({ answer: reply.answer, sections: reply.sections, suggestions: reply.suggestions }), /painel secreto/i, `${invented}: controle inventado não aparece`);
  }
});

test('pedido completo de outro assunto não herda o guia anterior por uma palavra em comum', async () => {
  const history = await crmHistory();
  const reply = await answerQuestion(root, 'Quero ver todos os passos para cadastrar um contato', {
    client: provider({ answer: 'Cadastrar um contato começa na Agenda de contatos.', sources: [contactsPath], steps: [step(contacts.documentedSteps[0])] }).client, history,
  });
  assert.equal(reply.sources[0]?.path, contactsPath, 'a fonte escolhida pelo modelo para o novo assunto vence a âncora');
  assert.deepEqual(reply.steps.map(({ text }) => text), contacts.documentedSteps);
  assert.doesNotMatch(JSON.stringify(reply.steps), /Pipeline/, 'nenhum passo de pipeline');
});

test('dúvida respondida no meio do guia não reinicia o roteiro', async () => {
  const history = [
    ...await crmHistory(),
    { role: 'user', content: 'Qual a diferença entre Pública e Privada?' },
    { role: 'assistant', content: `Pública: todos os usuários do iHelp. Privada: somente você e quem você definir.\nFonte usada: ${crmPath}` },
  ];
  const reply = await answerQuestion(root, 'Concluí este passo', { client: provider({ answer: 'Vamos à trava.' }).client, history });
  assert.deepEqual(reply.steps.map(({ text }) => text), [crm.documentedSteps[4]], 'segue do último passo mostrado do mesmo guia');
  assert.equal(reply.sources[0]?.path, crmPath);
});

test('pedido completo com troca de assunto segue o novo assunto', async () => {
  const history = await crmHistory();
  const reply = await answerQuestion(root, 'Quero ver todos os passos para criar um robô', {
    client: provider({ answer: 'Criar um robô começa em Robôs.', sources: [robotPath], steps: [step(robot.documentedSteps[0])] }).client, history,
  });
  assert.equal(reply.sources[0]?.path, robotPath);
  assert.deepEqual(reply.steps.map(({ text }) => text), robot.documentedSteps);
});

test('pedido de guiar em palavras do modelo entra no acompanhamento guiado', async () => {
  const history = await crmHistory();
  for (const phrase of ['Pode me acompanhar passo a passo?', 'Me guia etapa por etapa', 'Quero fazer isso passo a passo com você']) {
    const { client, calls } = provider({ answer: 'Vamos lá. A primeira tela é a lista de pipelines.', steps: crm.documentedSteps.map((text) => step(text)) });
    const reply = await answerQuestion(root, phrase, { client, history });
    assert.deepEqual(reply.steps.map(({ text }) => text), [crm.documentedSteps[0]], `${phrase}: começa pelo primeiro passo`);
    assert.equal(reply.steps[0].action?.id, 'abrir-crm');
    assert.equal(reply.answer, 'Vamos lá. A primeira tela é a lista de pipelines.', `${phrase}: narração do modelo`);
    assert.deepEqual(reply.suggestions, ['Concluí este passo', 'Preciso de ajuda']);
    assert.equal(calls.triage, 0, `${phrase}: sem triagem`);
  }
});

test('mudar e retomar assunto não herda o guia anterior', async () => {
  const history = await crmHistory();
  const campaignReply = provider({ answer: 'Campanha manda uma mensagem para vários contatos de uma vez.', sources: [campaignPath],
    steps: [step('Abra Campanhas e clique em Nova Campanha.')], suggestions: ['Como preparo a planilha?'] });
  const changed = await answerQuestion(root, 'e como crio uma campanha?', { client: campaignReply.client, history });
  assert.equal(changed.sources[0]?.path, campaignPath);
  assert.equal(changed.answer, 'Campanha manda uma mensagem para vários contatos de uma vez.');
  assert.doesNotMatch(developerPrompt(campaignReply.calls), /MODO: acompanhamento guiado/i);
  assert.match(developerPrompt(campaignReply.calls), /visão geral conversacional/i);
  assert.deepEqual(changed.steps.map(({ text }) => text), [campaign.documentedSteps[0]]);
  assert.equal(changed.steps[0].action?.id, 'abrir-campanhas');
  assert.deepEqual(changed.suggestions, ['Como preparo a planilha?'], 'sugestão do modelo não é trocada por fichas fixas');

  const back = provider({ answer: 'Pública: todos os usuários do iHelp. Departamento: só quem está no seu departamento. Privada: você e quem você definir.', sources: [crmPath] });
  const resumed = await answerQuestion(root, 'voltando ao crm, como escolho a visibilidade?', { client: back.client,
    history: [...history, { role: 'user', content: 'e como crio uma campanha?' }, { role: 'assistant', content: assistantTurn(changed) }] });
  assert.equal(resumed.sources[0]?.path, crmPath);
  assert.equal(resumed.answer, 'Pública: todos os usuários do iHelp. Departamento: só quem está no seu departamento. Privada: você e quem você definir.');
  assert.doesNotMatch(developerPrompt(back.calls), /MODO: acompanhamento guiado/i);
});

test('pessoa que não avançou recebe uma pergunta narrada a partir do estado do guia', async () => {
  const history = await crmHistory();
  const { client, calls } = provider((request) => ({ answer: stateNarration(request, 'sem estado') }));
  const stuck = await answerQuestion(root, 'não encontrei', { client, history });
  assert.deepEqual(stuck.steps, [], 'não repete o passo');
  assert.equal(stuck.sources[0]?.path, crmPath);
  const facts = calls.requests.at(-1).input.at(-1).content;
  assert.match(facts, /ESTADO DO GUIA[\s\S]*não encontrou ou não conseguiu fazer um dos passos 1 a 4/, 'o modelo recebe os passos mostrados em que a pessoa pode ter parado');
  assert.match(facts, /Pergunta sugerida: Você vê CRM no menu lateral\?/, 'a pergunta de diagnóstico vai como fato sugerido, não como texto imposto');
  assert.equal(stuck.answer, 'Você vê CRM no menu lateral?', 'a narração é do modelo (aqui, ecoando o fato)');
  assert.deepEqual(stuck.suggestions, ['Preciso de ajuda']);

  const silent = await answerQuestion(root, 'não encontrei', { client: provider({ answer: '' }).client, history });
  assert.equal(silent.answer, 'Você vê CRM no menu lateral?', 'sem narração do modelo, vale a pergunta de diagnóstico');
});

test('impasse digitado é conversa normal com a fonte da conversa', async () => {
  const history = await crmHistory();
  const asked = 'O que aparece na sua tela agora: o menu CRM à esquerda ou a lista de pipelines?';
  const { client, calls } = provider({ answer: asked, sources: [crmPath] });
  const reply = await answerQuestion(root, 'Não apareceu.', { client, history });
  assert.equal(reply.answer, asked, 'a pergunta útil é do modelo');
  assert.deepEqual(reply.steps, [], 'sem repetir o clique');
  assert.equal(reply.sources[0]?.path, crmPath);
  assert.match(calls.requests.at(-1).input.at(-1).content, /FONTE \d+: CRM e pipeline/, 'a fonte da conversa chega ao modelo');
  assert.doesNotMatch(developerPrompt(calls), /MODO: acompanhamento guiado/i);
});

test('pergunta conceitual continua conceitual', async () => {
  const { client, calls } = provider({ answer: 'Pipeline é o quadro do CRM onde cada oportunidade anda por estágios até fechar.',
    sources: [crmPath], suggestions: ['Como crio a minha primeira pipeline?'] });
  const reply = await answerQuestion(root, 'o que é uma pipeline?', { client });
  assert.equal(reply.answer, 'Pipeline é o quadro do CRM onde cada oportunidade anda por estágios até fechar.');
  assert.deepEqual(reply.steps, [], 'explicação não vira procedimento');
  assert.deepEqual(reply.suggestions, ['Como crio a minha primeira pipeline?']);
  assert.doesNotMatch(developerPrompt(calls), /MODO: visão geral conversacional|passo a passo completo|acompanhamento guiado/i);
});

test('prints e ações continuam restritos à fonte; prints documentados acompanham os passos ancorados', async () => {
  const reply = await answerQuestion(root, 'como criar um robô do zero?', { client: provider({
    answer: 'Um robô responde sozinho no WhatsApp. Você cria o robô, dá um nome e liga ao número.',
    steps: [
      step('Abra Robôs no menu e clique em Criar novo robô.', 'abrir-tudo', '/img/help/inventada.png'),
      step('Escreva um nome em Título do Robô.'),
      step('Em Canais, escolha o número e clique em Adicionar robô.'),
    ],
    sources: [robotPath],
  }).client });
  assert.deepEqual(reply.steps.map(({ text }) => text), robot.documentedSteps.slice(0, 3));
  assert.equal(reply.steps[0].action?.id, 'abrir-robos', 'actionId inventado não vale; a ação documentada do primeiro passo vale');
  assert.deepEqual(reply.steps.map((item) => item.image?.src), robot.stepImages.slice(0, 3));
  assert.doesNotMatch(JSON.stringify(reply), /inventada\.png|abrir-tudo/);
});

// Casos reais da validação em staging (C8, personas P40): transcrições em
// .regente/conversa-dinamica-0311/live-personas-c8f2a3584722/P40-{A,B,C}.json.
test('pedido completo "sem automação" depois de um aparte conceitual entrega o procedimento curado só com os passos obrigatórios', async () => {
  // P40-A3: a resposta 2 (conceitual) citou só o tutorial; o modelo citou o tutorial e o serviço entregou os 9 passos
  // numerados dele (2 de acesso + 7 de automação), sem os obrigatórios e apesar do "sem automação".
  const branch = crm.optionalBranch;
  assert.ok(branch, 'a fonte curada declara o ramo opcional');
  const history = [
    { role: 'user', content: 'Como configurar o CRM? É a primeira vez que entro no iHelp.' },
    { role: 'assistant', content: `Para organizar oportunidades no CRM, você cria uma pipeline e define seus estágios. Comece em Pipeline, na área de CRM.\n1. ${crm.documentedSteps[0]}\n2. ${crm.documentedSteps[1]}\n3. ${crm.documentedSteps[2]}\nFonte usada: ${crmPath}\nFonte usada: /docs/sobre-o-sistema/crm` },
    { role: 'user', content: 'Pipeline é o que? Eu quero acompanhar quem pediu orçamento e quem já comprou.' },
    { role: 'assistant', content: `Pipeline é um quadro visual onde cada oportunidade fica em um card e avança por etapas, do primeiro contato ao fechamento.\nFonte usada: ${tutorialPath}` },
  ];
  const reply = await answerQuestion(root, 'Quero ver todos os passos para começar sem automação.', { history, client: provider({
    answer: 'Siga estes passos para configurar e confirmar que ela está pronta para uso.',
    steps: tutorial.documentedSteps.map((text) => step(text)), sources: [tutorialPath],
  }).client });
  const mandatory = [...crm.documentedSteps.slice(0, branch.decision + 1), ...crm.documentedSteps.slice(branch.decline)];
  assert.deepEqual(reply.steps.map(({ text }) => text), mandatory, 'procedimento curado sem a etapa opcional dispensada, até a conclusão');
  assert.equal(reply.sources[0]?.path, crmPath, 'a fonte curada do guia em andamento responde pelo procedimento completo');
  assert.equal(reply.steps[0].action?.id, 'abrir-crm');
  assert.equal(reply.resolution, 'complete');
});

test('falha do provedor ou do orçamento numa dúvida de seguimento não injeta passos de outro assunto', async () => {
  // P40-B3: depois de criar a pipeline e dizer que só quer mudar o nome, a geração falhou e o fallback mostrou os
  // 3 primeiros passos de "Agenda de Contatos" (primeira fonte recuperada para "clientes"), sem relação com a conversa.
  const history = [
    { role: 'user', content: 'Como faço uma pipeline para minhas vendas?' },
    { role: 'assistant', content: `Você pode acompanhar suas oportunidades em um quadro por etapas e escolher o modelo Vendas padrão. Comece em CRM > Pipeline.\n1. ${crm.documentedSteps[0]}\n2. ${crm.documentedSteps[1]}\n3. ${crm.documentedSteps[2]}\nFonte usada: ${crmPath}\nFonte usada: ${tutorialPath}` },
    { role: 'user', content: 'Já tenho uma, só quero mudar.' },
    { role: 'assistant', content: `Entendi. Você quer mudar os estágios da pipeline, como editar, renomear ou reordenar, ou alterar outra coisa?\nFonte usada: ${tutorialPath}` },
  ];
  const question = 'Quero mudar o nome. Vai apagar os clientes?';
  const conversationPaths = new Set([crmPath, tutorialPath]);
  const failing = { responses: { create: async (request) => {
    if (request.text?.format?.name === 'triagem_fechada') return { status: 'completed', output_text: '{"choice":"sem guia"}', usage: { input_tokens: 1, output_tokens: 1 } };
    throw new Error('fixture: provedor indisponível');
  } } };
  const failed = await answerQuestion(root, question, { history, client: failing });
  assert.match(failed.answer, /Tive um problema/, 'fallback operacional honesto');
  assert.deepEqual(failed.steps, [], 'sem resposta do modelo não há passos de uma fonte qualquer');
  assert.ok(failed.sources.length > 0 && failed.sources.every(({ path }) => conversationPaths.has(path)), `só fontes da própria conversa: ${JSON.stringify(failed.sources.map(({ path }) => path))}`);
  assert.ok(!failed.sources.some(({ path }) => path === contactsPath), 'a Agenda de Contatos (primeira fonte recuperada) não entra');
  // Orçamento: a triagem (pedido pequeno) ainda é admitida; a geração (pedido grande) é negada.
  const budget = { file: join(root, 'budget-seguimento.json'), dailyLimitUsd: 0.12, reserveUsd: 0.05 };
  const exhausted = await answerQuestion(root, question, { history, client: provider({ answer: 'não deve ser chamada' }).client, budget });
  assert.doesNotMatch(exhausted.answer, /guia abaixo|não deve ser chamada/, 'sem guia inventado quando não há resposta');
  assert.deepEqual(exhausted.steps, []);
  assert.ok(exhausted.sources.every(({ path }) => conversationPaths.has(path)), `só fontes da própria conversa: ${JSON.stringify(exhausted.sources.map(({ path }) => path))}`);
  assert.ok(!exhausted.sources.some(({ path }) => path === contactsPath), 'a Agenda de Contatos não entra');
});

test('pergunta aberta inicial recebe visão geral: no máximo 5 passos, ancorados no procedimento principal', async () => {
  // P40-C1: "Como começo a organizar meus clientes no CRM?" — o modelo devolveu 14 passos (Contatos + Pipeline, 208
  // palavras) e o serviço entregou todos, porque a pergunta não casava com o modo de visão geral.
  const liveSteps = [
    'Abra Contatos no menu.', 'Clique em Adicionar Contato.', 'Preencha Nome e Telefone. Os demais campos são opcionais.',
    'Clique em Salvar. A mensagem “Contato criado com sucesso!” confirma o cadastro.',
    'Abra o contato em Contatos. Em Tags, use Buscar ou criar tag... para selecionar uma tag existente. A mensagem “Tag adicionada com sucesso!” confirma o vínculo.',
    'No contato, encontre Definir proprietário e clique em Editar. Escolha um departamento e o usuário responsável. Se a responsabilidade for apenas do departamento, selecione Somente departamento.',
    'Clique em Salvar. A mensagem “Proprietário atualizado com sucesso!” confirma a escolha.',
    'Abra Pipeline no CRM.', 'Clique em Nova Pipeline.', 'Preencha o nome, o responsável, a descrição, o ícone e a cor da Pipeline.',
    'Escolha a visibilidade: Pública, Departamento ou Privada.',
    'Defina a trava de contato: ativada para permitir um card por contato ou desativada para permitir vários cards.',
    'Clique em Próximo e escolha um modelo de estágios ou comece em branco. Clique em Próximo novamente.',
    'Se não quiser configurar automação, pule essa parte e clique em Criar Pipeline. Confira o novo quadro na lista; os estágios podem ser abertos.',
  ];
  const { client, calls } = provider({
    answer: 'Comece cadastrando os clientes em Contatos, onde você pode adicionar tags e definir um responsável. Depois, crie uma Pipeline no CRM para acompanhar as oportunidades por estágios.',
    steps: liveSteps.map((text) => step(text)), sources: [crmPath, contactsPath],
  });
  const reply = await answerQuestion(root, 'Como começo a organizar meus clientes no CRM?', { client });
  assert.ok(reply.steps.length > 0 && reply.steps.length <= 5, `visão inicial curta, não o despejo (${reply.steps.length} passos)`);
  // Os passos são de UM procedimento documentado, contíguo, da fonte por onde o modelo começou (a narração abre em
  // Contatos); texto e passos não divergem e nada de Tags/responsável ou Pipeline entra na primeira resposta.
  const shownSource = [contacts, crm].find((source) => source.documentedSteps.includes(reply.steps[0].text));
  assert.ok(shownSource, 'passos documentados');
  const indexes = reply.steps.map(({ text }) => shownSource.documentedSteps.indexOf(text));
  assert.deepEqual(indexes, indexes.map((_, offset) => indexes[0] + offset), 'sequência contígua de um único procedimento');
  assert.equal(shownSource, contacts, 'o procedimento mostrado é o que a narração do modelo abre');
  assert.ok(reply.steps.every(({ text }) => !/Tag|proprietário|Pipeline/i.test(text)), 'sem procedimentos extras na visão inicial');
  assert.equal(reply.sources[0]?.path, shownSource.path, 'a primeira fonte citada é a do procedimento mostrado');
  assert.match(developerPrompt(calls), /MODO: visão geral conversacional/, 'pergunta procedural aberta é visão geral para o modelo');
  assert.match(reply.answer, /^Comece cadastrando os clientes em Contatos/, 'a narração continua sendo do modelo');
  assert.doesNotMatch(reply.answer, /Não consegui organizar|Siga os passos abaixo/);
});

test('dúvida sobre as opções do guia em andamento mantém a fonte do guia no contexto, mesmo quando uma palavra aponta outro módulo', async () => {
  // P60-B2: "Qual a diferença entre Pública, Departamento e Privada?" no meio do guia da pipeline foi roteada pela
  // palavra "Departamento" ao módulo de departamentos (contexto de negócio); a fonte do CRM, que lista as três
  // opções, saiu do contexto e a resposta virou "Departamento é uma divisão da empresa".
  const question = 'Qual a diferença entre Pública, Departamento e Privada?';
  const departmentsPath = '/docs/sobre-o-sistema/configuracoes/departamentos';
  const businessDir = await mkdtemp(join(tmpdir(), 'claricia-negocio-'));
  const previous = process.env.BUSINESS_CONTEXT_DIR;
  try {
    await writeFile(join(businessDir, 'geral.md'), '🟢 PÚBLICO\nO produto fictício organiza equipes.');
    await writeFile(join(businessDir, 'configuracoes-departamentos.md'), '🟢 PÚBLICO\nDepartamento fictício é uma divisão da empresa.');
    process.env.BUSINESS_CONTEXT_DIR = businessDir;
    const fake = (answer, sources) => {
      const requests = [];
      const client = { responses: { create: async (request) => {
        const name = request.text?.format?.name;
        if (name === 'triagem_fechada') return { status: 'completed', output_text: '{"choice":"sem guia"}', usage: { input_tokens: 1, output_tokens: 1 } };
        if (name === 'seguranca_resposta') return { status: 'completed', output_text: JSON.stringify({ mentionsSource: false, unsupportedAction: false }), usage: { input_tokens: 1, output_tokens: 1 } };
        requests.push(request);
        return { model: 'fixture', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output_text: JSON.stringify({
          answer, sections: [], steps: [], code: null, sources, suggestions: [], resolution: 'complete', found: true,
        }) };
      } } };
      return { requests, client };
    };
    const inGuide = fake('Pública: todos veem. Departamento: só quem é do seu departamento. Privada: só você e quem convidar.', [crmPath]);
    const reply = await answerQuestion(root, question, { client: inGuide.client, history: await crmHistory() });
    assert.ok(inGuide.requests.length, 'o modelo foi chamado');
    assert.match(inGuide.requests[0].input.at(-1).content, new RegExp(`URL: ${crmPath}`), 'a fonte do guia em andamento continua no contexto do modelo');
    assert.equal(reply.sources[0]?.path, crmPath, 'a fonte do guia citada pelo modelo é aceita');
    assert.equal(reply.answer, 'Pública: todos veem. Departamento: só quem é do seu departamento. Privada: só você e quem convidar.');
    // Sem guia em andamento, uma pergunta só sobre departamento segue conceitual pelo módulo de departamentos.
    const alone = fake('Departamento é uma divisão da empresa.', [departmentsPath]);
    const conceptual = await answerQuestion(root, 'O que é um departamento?', { client: alone.client });
    assert.ok(alone.requests.length, 'o modelo foi chamado');
    assert.doesNotMatch(alone.requests[0].input.at(-1).content, new RegExp(`URL: ${crmPath}`), 'sem histórico, nenhuma fonte de pipeline é imposta');
    assert.equal(conceptual.sources[0]?.path, departmentsPath);
  } finally {
    if (previous === undefined) delete process.env.BUSINESS_CONTEXT_DIR; else process.env.BUSINESS_CONTEXT_DIR = previous;
    await rm(businessDir, { recursive: true, force: true });
  }
});

test('pedido explícito de outro procedimento vence o guia em andamento, mesmo quando as páginas se linkam', async () => {
  // Revisor (C7): Agenda de Contatos e Robô de Atendimento linkam uma à outra; depois de passos de Contatos, "Quero ver
  // todos os passos para criar um robô" com o modelo citando o robô não pode voltar a Contatos por causa do link.
  const history = [
    { role: 'user', content: 'Como cadastro um contato?' },
    { role: 'assistant', content: `Comece em Contatos.\n1. ${contacts.documentedSteps[0]}\nFonte usada: ${contactsPath}` },
  ];
  const reply = await answerQuestion(root, 'Quero ver todos os passos para criar um robô', { history, client: provider({
    answer: 'Aqui vai o caminho do robô, do início ao fim.', sources: [robotPath], steps: [step(robot.documentedSteps[0])],
  }).client });
  assert.equal(reply.sources[0]?.path, robotPath, 'a nova tarefa explícita segue a fonte escolhida pelo modelo');
  assert.deepEqual(reply.steps.map(({ text }) => text), robot.documentedSteps, 'procedimento completo do robô');
  assert.ok(!reply.steps.some(({ text }) => contacts.documentedSteps.includes(text)), 'nenhum passo de Contatos');
});

test('negativa da etapa opcional em paráfrase comum conta; dupla negação não conta', async () => {
  const history = await crmHistory();
  const branch = crm.optionalBranch;
  const mandatory = [...crm.documentedSteps.slice(0, branch.decision + 1), ...crm.documentedSteps.slice(branch.decline)];
  const ask = (question) => answerQuestion(root, question, { history, client: provider({
    answer: 'Aqui vai o caminho.', sources: [crmPath], steps: [step('Abra Pipeline no CRM.')],
  }).client });
  const declined = await ask('Quero ver todos os passos, mas não quero configurar automação agora');
  assert.deepEqual(declined.steps.map(({ text }) => text), mandatory, 'negação a três palavras do termo ainda é recusa');
  const doubleNegative = await ask('Quero ver todos os passos, não quero pular a automação');
  assert.deepEqual(doubleNegative.steps.map(({ text }) => text), crm.documentedSteps, '"não quero pular" não é recusa: sequência inteira');
});

test('prompt pede escrita natural, contexto do histórico e sugestões na voz da pessoa', async () => {
  const { client, calls } = provider(crmReply);
  await askCrm(client, { history: [
    { role: 'user', content: 'Já uso o iHelp há meses, só nunca mexi no CRM.' },
    { role: 'assistant', content: 'Entendi.' },
  ] });
  const prompt = developerPrompt(calls);
  assert.match(prompt, /cumpriment|saudaç/i, 'sem saudação ou elogio de abertura');
  assert.match(prompt, /travessão/i, 'sem travessão');
  assert.match(prompt, /não é X, é Y|contraste/i, 'sem contraste artificial');
  assert.match(prompt, /já (?:informou|disse|sabe|fez)/i, 'parte do que a pessoa já informou');
  assert.match(prompt, /termo[^.]*(?:necess|precisar)/i, 'termos só quando necessários');
  assert.match(prompt, /voz da pessoa/i, 'sugestões como fala da pessoa');
  assert.match(prompt, /VISÃO INICIAL[^.]*(?:apoio|referência)/i, 'visão editorial é apoio, não resposta');
  assert.match(prompt, /steps vazio|sem passos/i, 'zero passos é permitido quando a pergunta basta');
  assert.doesNotMatch(prompt, /seção “O caminho”|máximo 3 fases/i, 'sem estrutura decorativa imposta');
  assert.doesNotMatch(prompt, /30 segundos/i, 'não presume sempre os primeiros 30 segundos');
  const descriptions = JSON.stringify(calls.requests.at(-1).text.format.schema);
  assert.match(descriptions, /voz da pessoa/i);
});

test.after(async () => { await rm(root, { recursive: true, force: true }); });
