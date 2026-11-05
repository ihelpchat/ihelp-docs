// Regressões da bateria pública real de 27 turnos (fonte ad3e43f, 2026-11-04): três contradições de composição e
// duas falhas de infraestrutura confirmadas na fonte. Históricos copiados literalmente das requests reais (o widget
// envia o histórico inteiro, com "Fonte usada:"). O cliente é falso: nenhuma chamada paga; o que se prova é a
// composição do servidor a partir do que o modelo pode devolver.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';

const projectRoot = new URL('../', import.meta.url).pathname;
const root = await mkdtemp(join(tmpdir(), 'claricia-public27-'));
await cp(join(projectRoot, 'architecture'), join(root, 'architecture'), { recursive: true });
await cp(join(projectRoot, 'content'), join(root, 'content'), { recursive: true });
const initialBusiness = process.env.BUSINESS_CONTEXT_DIR;
delete process.env.BUSINESS_CONTEXT_DIR;
after(async () => {
  if (initialBusiness === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
  else process.env.BUSINESS_CONTEXT_DIR = initialBusiness;
  await rm(root, { recursive: true, force: true });
});

const crmPath = '/docs/principais-motivos-de-suporte/crm';
const crmAreaPath = '/docs/sobre-o-sistema/crm';
const tutorialPath = '/docs/sobre-o-sistema/crm/como-criar-uma-nova-pipeline';
const robotPath = '/docs/sobre-o-sistema/robo-de-atendimento';
const sourceOf = async (question, path) => (await retrieveContext(root, question, 8)).find((source) => source.path === path);
const crm = await sourceOf('Como criar pipeline no CRM?', crmPath);
const robot = await sourceOf('Robô de Atendimento', robotPath);
assert.equal(crm.documentedSteps.length, 16, 'a fonte curada do CRM tem 16 passos');
assert.ok(crm.optionalBranch, 'a fonte do CRM declara o ramo opcional');
assert.ok(robot.documentedSteps.length >= 3, 'a página de Robôs tem passos documentados');

const usage = { input_tokens: 1, output_tokens: 1 };
const ok = (text) => ({ status: 'completed', output_text: text, usage });
const step = (text) => ({ text, actionId: null, imagePath: null });
/** Cliente falso: triagem "sem guia", classificador roteirizado por chamada, geração com o corpo informado. */
function fake(reply, { safety = [], triage = 'ok' } = {}) {
  const calls = { triage: 0, answer: 0, safety: 0, requests: [] };
  const client = { responses: { create: async (request) => {
    const name = request.text?.format?.name;
    if (name === 'triagem_fechada') {
      calls.triage += 1;
      if (triage === 'throw') throw new Error('offline');
      return ok('{"choice":"sem guia"}');
    }
    if (name === 'seguranca_resposta') {
      const verdict = safety[calls.safety] ?? { mentionsSource: false, unsupportedAction: false };
      calls.safety += 1;
      if (verdict === 'throw') throw new Error('offline');
      return ok(JSON.stringify(verdict));
    }
    calls.answer += 1;
    calls.requests.push(request);
    const body = typeof reply === 'function' ? reply(request, calls.answer) : reply;
    if (body === 'throw') throw new Error('offline');
    return { model: 'fixture', status: 'completed', usage, output_text: JSON.stringify({
      plan: { intent: 'execute', optionalBranch: 'unspecified' }, sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true, ...body,
    }) };
  } } };
  return { client, calls };
}

// ---------- Caso real P60-B, turno 3: relato de conclusão não reinicia a criação ----------
const fullSteps = crm.documentedSteps.map((text, index) => `${index + 1}. ${text}`).join('\n');
const historyP60B = [
  { role: 'user', content: 'Como criar uma pipeline no CRM? Quero ler o caminho todo antes de começar.' },
  { role: 'assistant', content: `No CRM, abra Pipeline e siga o fluxo até clicar em Criar Pipeline. A automação é opcional; você pode ignorá-la e criar o quadro sem configurar gatilhos.\nAntes de começar\n- Você precisa ter acesso ao CRM.\n${fullSteps}\nFonte usada: ${crmPath}\nFonte usada: ${tutorialPath}` },
  { role: 'user', content: 'Qual a diferença entre Pública, Departamento e Privada?' },
  { role: 'assistant', content: `A visibilidade define quem pode ver a pipeline. Pública fica visível para todos os usuários do iHelp; Departamento, só para usuários do seu departamento; Privada, só para você e as pessoas convidadas.\nFonte usada: ${tutorialPath}\nFonte usada: ${crmAreaPath}` },
];
const doneAnswer = 'A criação deu certo quando a pipeline aparece na lista e você consegue abrir os estágios. Criar a pipeline não faz o robô responder: a automação dela cria cards; o Robô de Atendimento só passa a valer depois que você monta o fluxo e clica em Publicar.';

test('P60-B3: "Terminei de criar. Como sei se deu certo?" não devolve de novo o passo de criar', async () => {
  const { client, calls } = fake({ plan: { intent: 'confirm_completion', optionalBranch: 'unspecified' }, answer: doneAnswer, steps: [step(crm.documentedSteps[15])], sources: [crmPath, robotPath],
    suggestions: ['Como sei se a automação está funcionando?', 'O que muda depois de publicar o robô?'] });
  const reply = await answerQuestion(root, 'Terminei de criar. Como sei se deu certo? O robô já começa a responder?',
    { client, history: historyP60B });
  assert.equal(calls.answer, 1);
  assert.equal(reply.answer, doneAnswer, 'a explicação do modelo é preservada');
  assert.deepEqual(reply.steps, [], 'relato de conclusão: nenhum passo já mostrado volta, muito menos "Criar Pipeline"');
  assert.match(calls.requests[0].input[0].content, /confirm_completion/u, 'a geração decide a intenção com o histórico');
});

test('controle: pedido amplo de começar continua com visão geral ancorada (≤ 5 passos)', async () => {
  const { client } = fake({ answer: 'Comece abrindo Pipeline no CRM.', steps: crm.documentedSteps.slice(0, 3).map(step), sources: [crmPath] });
  const reply = await answerQuestion(root, 'Como começo a criar uma pipeline?', { client });
  assert.ok(reply.steps.length >= 1 && reply.steps.length <= 5);
  assert.equal(reply.steps[0].text, crm.documentedSteps[0]);
});

// ---------- Caso real P60-C, turno 3: pergunta de entendimento não recebe passos de criar ----------
const historyP60C = [
  { role: 'user', content: 'Estou tentando configurar o CRM e não sei o que escolher.' },
  { role: 'assistant', content: `Na criação de uma pipeline, você escolhe quem pode vê-la, se um contato pode ter mais de um card e quais estágios usar; a automação é opcional. Qual dessas escolhas está te deixando em dúvida?\nOpções disponíveis\n- Visibilidade: Pública, Departamento ou Privada.\n- Trava de contato: ativada para limitar a um card por contato ou desativada para permitir vários cards.\n- Estágios: escolha um modelo ou comece em branco.\nFonte usada: ${crmPath}\nFonte usada: ${crmAreaPath}` },
  { role: 'user', content: 'Não apareceu. Preciso mandar uma foto ou dizer o nome da tela?' },
  { role: 'assistant', content: `Diga o nome da tela e o que esperava ver; se apareceu algum aviso, copie o texto. Qual tela está aberta agora?\nFonte usada: ${crmPath}` },
];
const robotAnswer = 'Os robôs seguem um fluxo que você configura: mostram mensagens e opções e podem encaminhar a conversa para uma equipe. Eles não respondem livremente a qualquer pergunta; para começarem a atender, precisam ter um fluxo montado e publicado.';

test('P60-C3: "Onde começo para entender os robôs?" explica sem passos de criar robô', async () => {
  const { client, calls } = fake({ plan: { intent: 'explain', optionalBranch: 'unspecified' }, answer: robotAnswer, steps: robot.documentedSteps.slice(0, 3).map(step), sources: [robotPath],
    suggestions: ['O que um fluxo pode fazer?', 'Qual a diferença entre mensagem e menu?'] });
  const reply = await answerQuestion(root, 'Vou deixar o CRM para depois. Onde começo para entender os robôs?', { client, history: historyP60C });
  assert.equal(calls.answer, 1);
  assert.equal(reply.answer, robotAnswer);
  assert.equal(reply.sources[0]?.path, robotPath);
  assert.deepEqual(reply.steps, [], 'pergunta de entendimento: zero passos, mesmo que o modelo devolva passos documentados');
  assert.ok(reply.suggestions.length, 'as sugestões do modelo continuam');
});

test('controle: "Como começo a criar um robô?" segue com passos documentados', async () => {
  const { client } = fake({ answer: 'Você cria o robô em Robôs.', steps: robot.documentedSteps.slice(0, 3).map(step), sources: [robotPath] });
  const reply = await answerQuestion(root, 'Como começo a criar um robô?', { client });
  assert.ok(reply.steps.length >= 1);
  assert.equal(reply.steps[0].text, robot.documentedSteps[0]);
});

// ---------- Caso real P50-C, turno 2: narrativa dispensa a etapa opcional, passos têm de acompanhar ----------
const historyP50C = [
  { role: 'user', content: 'Posso usar o CRM sem robô? E o que é pipeline?' },
  { role: 'assistant', content: `Tive um problema para responder agora. Tente de novo ou fale com uma pessoa.\nFonte usada: ${crmPath}\nFonte usada: ${crmAreaPath}\nFonte usada: ${robotPath}` },
];
const skipAnswer = 'Você pode criar a pipeline sem configurar automações ou robô. Siga os passos abaixo e pule a etapa opcional de automação.';
const { decision, accept, decline } = crm.optionalBranch;
const mandatory = crm.documentedSteps.filter((_, index) => index <= decision || index >= decline);
assert.ok(mandatory.length < 16 && mandatory.length >= 2);

test('P50-C2: plano da mesma geração dispensa o ramo opcional → sequência completa só com os obrigatórios', async () => {
  const { client } = fake({ plan: { intent: 'execute', optionalBranch: 'skip' }, answer: skipAnswer, steps: mandatory.map(step), sources: [crmPath, tutorialPath] });
  const reply = await answerQuestion(root, 'Quero ver todos os passos para criar uma, sem configurar robô agora.', { client, history: historyP50C });
  assert.equal(reply.answer, skipAnswer);
  assert.deepEqual(reply.steps.map(({ text }) => text), mandatory, 'nenhum passo do ramo opcional (aceite até a retomada) volta');
});

test('controle: modelo mantém o ramo opcional → sequência completa com os 16 passos', async () => {
  const withOptional = crm.documentedSteps.filter((_, index) => index <= decision || index === accept || index >= decline);
  const { client } = fake({ answer: 'Siga os passos, incluindo a automação se quiser.', steps: withOptional.map(step), sources: [crmPath] });
  const reply = await answerQuestion(root, 'Quero ver todos os passos para criar uma pipeline.', { client, history: historyP50C });
  assert.equal(reply.steps.length, 16);
});

// ---------- Infraestrutura: classificador indisponível × recusa de conteúdo; triagem memoizada por invocação ----------
async function withBusiness(run) {
  const businessDir = await mkdtemp(join(tmpdir(), 'claricia-negocio-'));
  const previous = process.env.BUSINESS_CONTEXT_DIR;
  try {
    await writeFile(join(businessDir, 'geral.md'), '🟢 PÚBLICO\nO produto fictício organiza equipes.');
    await writeFile(join(businessDir, 'crm.md'), '🟢 PÚBLICO\nPipeline fictícia organiza oportunidades.');
    process.env.BUSINESS_CONTEXT_DIR = businessDir;
    await run();
  } finally {
    if (previous === undefined) delete process.env.BUSINESS_CONTEXT_DIR; else process.env.BUSINESS_CONTEXT_DIR = previous;
    await rm(businessDir, { recursive: true, force: true });
  }
}
const conceptual = 'o que é uma pipeline?';
const fixedError = 'Tive um problema para responder agora. Tente de novo ou fale com uma pessoa.';

test('classificador indisponível: falha fechada em uma passagem, sem segunda geração paga, com motivo técnico', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake({ answer: 'Pipeline é um quadro de estágios.', sources: [crmPath] }, { safety: ['throw'] });
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, fixedError);
    assert.deepEqual(reply.fallback, { branch: 'classifier', reason: 'exception', pass: 1 });
    assert.equal(calls.answer, 1, 'nenhuma segunda passagem quando o classificador está indisponível');
    assert.equal(calls.triage, 1);
    assert.equal(calls.safety, 1);
  });
});

test('recusa de conteúdo: segunda passagem sem negócio, triagem reutilizada; recusa repetida vira fallback com motivo', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake((request, pass) => ({ answer: pass === 1 ? 'primeira' : 'segunda', sources: [crmPath] }),
      { safety: [{ mentionsSource: false, unsupportedAction: true }, { mentionsSource: false, unsupportedAction: true }] });
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, fixedError);
    assert.deepEqual(reply.fallback, { branch: 'classifier', reason: 'unsupportedAction', pass: 2 });
    assert.equal(calls.answer, 2, 'a recusa de conteúdo ainda revalida sem contexto de negócio');
    assert.equal(calls.safety, 2);
    assert.equal(calls.triage, 1, 'a triagem é reutilizada dentro da mesma invocação (mesmos insumos)');
  });
});

test('recusa na primeira passagem e aprovação na segunda devolvem a resposta validada, sem fallback', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake((request, pass) => ({ answer: pass === 1 ? 'primeira' : 'segunda', sources: [crmPath] }),
      { safety: [{ mentionsSource: true, unsupportedAction: false }, { mentionsSource: false, unsupportedAction: false }] });
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, 'segunda');
    assert.equal(reply.fallback, undefined);
    assert.equal(calls.answer, 2);
    assert.equal(calls.triage, 1);
  });
});

test('triagem e geração indisponíveis identificam o ramo do fallback', async () => {
  const router = fake({ answer: 'não usado', sources: [crmPath] }, { triage: 'throw' });
  const routed = await answerQuestion(root, 'Como criar uma pipeline?', { client: router.client });
  assert.match(routed.answer, /^Tive um problema para responder agora\./u);
  assert.deepEqual(routed.fallback, { branch: 'router', reason: 'provider_failed', pass: 1 });
  assert.equal(router.calls.answer, 0);
  const generation = fake('throw');
  const generated = await answerQuestion(root, 'Como criar uma pipeline?', { client: generation.client });
  assert.match(generated.answer, /^Tive um problema para responder agora\./u);
  assert.deepEqual(generated.fallback, { branch: 'generation', reason: 'exception', pass: 1 });
});

for (const question of ['Quero repetir os passos para criar uma pipeline.', 'Terminei de criar. Quero criar outra.', 'Já posso criar?', 'Quero aprender a criar um robô.', 'Não quero só entender, quero configurar um robô.', 'Já entendi, como crio?']) {
  test(`intenção mista/execução legítima mantém passos: ${question}`, async () => {
    const { client } = fake({ answer: 'Os passos abaixo mostram o caminho.', steps: crm.documentedSteps.slice(0, 3).map(step), sources: [crmPath] });
    const reply = await answerQuestion(root, question, { client, history: historyP60B });
    assert.ok(reply.steps.length > 0);
    assert.equal(reply.steps[0].text, crm.documentedSteps[0]);
  });
}
for (const optionalBranch of ['include', 'unspecified']) {
  test(`lista incompleta não dispensa ramo: ${optionalBranch}`, async () => {
    const { client } = fake({ plan: { intent: 'execute', optionalBranch }, answer: 'A automação é opcional.', steps: mandatory.map(step), sources: [crmPath] });
    const reply = await answerQuestion(root, 'Quero ver todos os passos para criar uma pipeline.', { client });
    assert.deepEqual(reply.steps.map(({ text }) => text), crm.documentedSteps);
  });
}
for (const intent of ['explain', 'clarify', 'confirm_completion']) {
  test(`plano ${intent} não deixa instruções de criação em outros campos`, async () => {
    const { client } = fake({ plan: { intent, optionalBranch: 'unspecified' }, answer: 'Crie uma pipeline.', sections: [{ title: 'Começo', items: ['Clique em Nova Pipeline.'] }], suggestions: ['Como crio uma pipeline?'], steps: crm.documentedSteps.slice(0, 3).map(step), sources: [crmPath] });
    const reply = await answerQuestion(root, 'Como configurar o CRM?', { client });
    assert.deepEqual(reply.steps, []);
    assert.doesNotMatch(reply.answer, /Crie|Clique/u);
    assert.deepEqual(reply.sections, []);
    assert.deepEqual(reply.suggestions, []);
  });
}
for (const plan of [undefined, null, { intent: 'bad', optionalBranch: 'skip' }, { intent: 'execute' }]) {
  test(`plano ausente/inválido falha fechado: ${JSON.stringify(plan)}`, async () => {
    const { client, calls } = fake({ plan, answer: 'Crie uma pipeline.', steps: crm.documentedSteps.map(step), sources: [crmPath] });
    const reply = await answerQuestion(root, 'Como criar uma pipeline?', { client });
    assert.deepEqual(reply.steps, []);
    assert.equal(reply.fallback?.reason, 'invalid_plan');
    assert.equal(calls.answer, 1);
    assert.equal(JSON.stringify(reply).includes('fallback'), false, 'metadados internos não vão no HTTP');
  });
}


test('routing isolado entre duas pessoas e duas invocações, mesmo com o mesmo client', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake({ answer: 'Pipeline organiza oportunidades.', sources: [crmPath] },
      { safety: [{ mentionsSource: true, unsupportedAction: false }, { mentionsSource: false, unsupportedAction: false },
        { mentionsSource: true, unsupportedAction: false }, { mentionsSource: false, unsupportedAction: false }] });
    const first = await answerQuestion(root, conceptual, { client, history: [{ role: 'user', content: 'Quero entender o quadro.' }] });
    const second = await answerQuestion(root, conceptual, { client, history: [{ role: 'user', content: 'Estou vendo uma pipeline.' }] });
    assert.equal(first.answer, 'Pipeline organiza oportunidades.');
    assert.equal(second.answer, first.answer);
    assert.equal(calls.triage, 2);
    assert.equal(calls.answer, 4);
    assert.equal(calls.safety, 4);
  });
});

test('plano de entendimento também governa os passos com contexto de negócio', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake({ plan: { intent: 'explain', optionalBranch: 'unspecified' }, answer: 'Pipeline organiza oportunidades.',
      steps: crm.documentedSteps.slice(0, 2).map((text, i) => ({ ...step(text), sourceStepId: `faq-1-step-${i + 1}` })), sources: [crmPath] });
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, 'Pipeline organiza oportunidades.');
    assert.deepEqual(reply.steps, []);
    assert.equal(calls.answer, 1);
    assert.equal(calls.safety, 1);
  });
});

test('sem robô não significa dispensa automática de automação CRM', async () => {
  const { client } = fake({ answer: 'A automação é opcional.', steps: mandatory.map(step), sources: [crmPath] });
  const reply = await answerQuestion(root, 'Quero ver todos os passos para criar uma pipeline, sem configurar robô agora.', { client });
  assert.deepEqual(reply.steps.map(({ text }) => text), crm.documentedSteps);
});

test('dispensa explícita continua protegida; plano contraditório falha fechado', async () => {
  const { client } = fake({ plan: { intent: 'execute', optionalBranch: 'include' }, answer: 'Inclua a automação.', sources: [crmPath] });
  const reply = await answerQuestion(root, 'Quero todos os passos para criar uma pipeline sem automação.', { client });
  assert.deepEqual(reply.steps, []);
  assert.equal(reply.fallback?.reason, 'plan_conflict');
});


test('confirmação admite verificar o resultado sem repetir a criação', async () => {
  const answer = 'Confira se a pipeline aparece na lista.';
  const { client } = fake({ plan: { intent: 'confirm_completion', optionalBranch: 'unspecified' }, answer, sources: [crmPath] });
  const reply = await answerQuestion(root, 'Terminei de criar. Como sei se deu certo?', { client, history: historyP60B });
  assert.equal(reply.answer, answer);
  assert.deepEqual(reply.steps, []);
});

test('instrução de criar depois de oração explicativa também conflita com entendimento', async () => {
  const { client } = fake({ plan: { intent: 'explain', optionalBranch: 'unspecified' }, answer: 'Para conhecer o recurso, crie uma pipeline.', sources: [crmPath] });
  const reply = await answerQuestion(root, 'Quero entender o CRM.', { client });
  assert.deepEqual(reply.steps, []);
  assert.equal(reply.fallback?.reason, 'plan_conflict');
});

test('plano indefinido não combina narrativa de dispensa com procedimento inteiro', async () => {
  const { client } = fake({ answer: 'Pule a etapa opcional.', sources: [crmPath], steps: mandatory.map(step) });
  const reply = await answerQuestion(root, 'Quero ver todos os passos para criar uma pipeline.', { client });
  assert.deepEqual(reply.steps, []);
  assert.equal(reply.fallback?.reason, 'plan_conflict');
});

test('abort depois da geração fecha classificador, sem repetir; próxima pessoa tem routing próprio', async () => {
  await withBusiness(async () => {
    const controller = new AbortController();
    const { client, calls } = fake(() => { controller.abort(); return { answer: 'Pipeline organiza oportunidades.', sources: [crmPath] }; });
    const budget = { file: join(root, 'abort-budget.json'), dailyLimitUsd: 10, reserveUsd: 0.1, signal: controller.signal };
    const reply = await answerQuestion(root, conceptual, { client, budget });
    assert.equal(reply.fallback?.reason, 'provider_failed');
    assert.equal(reply.fallback?.branch, 'classifier');
    assert.equal(calls.answer, 1);
    assert.equal(calls.safety, 0);
    const next = fake({ answer: 'Pipeline organiza oportunidades.', sources: [crmPath] });
    assert.equal((await answerQuestion(root, conceptual, { client: next.client })).answer, 'Pipeline organiza oportunidades.');
    assert.equal(next.calls.triage, 1);
    assert.equal(next.calls.answer, 1);
  });
});


test('menção a alternativa sem automação não dispensa o ramo escolhido', async () => {
  const answer = 'Também é possível seguir sem automação; você escolheu incluir essa etapa.';
  const { client } = fake({ plan: { intent: 'execute', optionalBranch: 'include' }, answer, steps: crm.documentedSteps.map(step), sources: [crmPath] });
  const reply = await answerQuestion(root, 'Quero todos os passos para criar uma pipeline com automação.', { client });
  assert.equal(reply.answer, answer);
  assert.deepEqual(reply.steps.map(({ text }) => text), crm.documentedSteps);
});

// Recuperação de conteúdo: contratos novos, provider falso; não reproduzem candidatos reais rejeitados.
const conflictBody = { plan: { intent: 'clarify', optionalBranch: 'unspecified' }, answer: 'Crie uma pipeline.', sources: [crmPath] };
const recoveredBody = { plan: { intent: 'clarify', optionalBranch: 'unspecified' }, answer: 'Você quer entender o quadro ou ajustar um que já existe?', sources: [crmPath] };
const reviewOf = (request) => request.input.filter(({ role }) => role === 'developer').map(({ content }) => content).join(' ');
const hasReview = (request, branch, reason) => reviewOf(request).includes(JSON.stringify({ branch, reason }));

test('recuperação: conflito de composição pode gerar uma resposta dinâmica validada sem business', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake((request, pass) => pass === 1 ? conflictBody : recoveredBody);
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, recoveredBody.answer);
    assert.equal(reply.fallback, undefined);
    assert.deepEqual(reply.steps, []);
    assert.equal(calls.answer, 2);
    assert.equal(calls.triage, 1);
    assert.equal(calls.safety, 1, 'a recuperação também passa pelo safety aplicável');
    assert.ok(hasReview(calls.requests[1], 'composition', 'plan_conflict'));
    assert.match(calls.requests[0].input.at(-1).content, /Produto fictício|produto fictício/u);
    assert.doesNotMatch(calls.requests[1].input.at(-1).content, /produto fictício|Pipeline fictícia/u);
    assert.equal(JSON.stringify(reply).includes('plan_conflict'), false, 'feedback não entra no JSON público');
    assert.equal(JSON.stringify(reply).includes('REVISÃO INTERNA'), false);
  });
});
for (const reason of ['mentionsSource', 'unsupportedAction']) {
  test(`recuperação: classificador transmite motivo ${reason} ao redator e revalida`, async () => {
    await withBusiness(async () => {
      const { client, calls } = fake((request, pass) => pass === 1
        ? { answer: 'Explicação inicial.', sources: [crmPath] } : recoveredBody,
      { safety: [{ mentionsSource: reason === 'mentionsSource', unsupportedAction: reason === 'unsupportedAction' }, { mentionsSource: false, unsupportedAction: false }] });
      const reply = await answerQuestion(root, conceptual, { client });
      assert.equal(reply.answer, recoveredBody.answer);
      assert.equal(reply.fallback, undefined);
      assert.equal(calls.answer, 2);
      assert.equal(calls.safety, 2);
      assert.equal(calls.triage, 1);
      assert.ok(hasReview(calls.requests[1], 'classifier', reason));
      assert.equal(JSON.stringify(reply).includes(reason), false);
    });
  });
}
test('recuperação: composição e classificador compartilham duas gerações, não três', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake((request, pass) => pass === 1 ? conflictBody : recoveredBody,
      { safety: [{ mentionsSource: false, unsupportedAction: true }] });
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, fixedError);
    assert.deepEqual(reply.fallback, { branch: 'classifier', reason: 'unsupportedAction', pass: 2 });
    assert.deepEqual(reply.steps, []);
    assert.equal(calls.answer, 2);
    assert.equal(calls.safety, 1);
    assert.equal(calls.triage, 1);
  });
});
test('recuperação: rejeição do classificador não permite bypass de composição na segunda resposta', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake((request, pass) => pass === 1 ? recoveredBody : conflictBody,
      { safety: [{ mentionsSource: true, unsupportedAction: false }] });
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, fixedError);
    assert.deepEqual(reply.fallback, { branch: 'composition', reason: 'plan_conflict', pass: 2 });
    assert.equal(calls.answer, 2);
    assert.equal(calls.safety, 1);
    assert.deepEqual(reply.steps, []);
  });
});
for (const [second, branch, reason] of [
  [conflictBody, 'composition', 'plan_conflict'],
  [{ ...recoveredBody, plan: null }, 'composition', 'invalid_plan'],
  ['throw', 'generation', 'exception'],
]) {
  test(`recuperação: segunda falha ${branch}/${reason} encerra com fallback seguro`, async () => {
    const { client, calls } = fake((request, pass) => pass === 1 ? conflictBody : second);
    const reply = await answerQuestion(root, conceptual, { client });
    assert.equal(reply.answer, fixedError);
    assert.deepEqual(reply.fallback, { branch, reason, pass: 2 });
    assert.deepEqual(reply.steps, []);
    assert.equal(reply.code, null);
    assert.equal(calls.answer, 2);
    assert.equal(calls.triage, 1);
  });
}
test('recuperação: conflito de ramo opcional é corrigido com os mesmos obrigatórios', async () => {
  const { client, calls } = fake((request, pass) => ({
    plan: { intent: 'execute', optionalBranch: pass === 1 ? 'include' : 'skip' },
    answer: 'Siga os passos abaixo.', steps: crm.documentedSteps.map(step), sources: [crmPath],
  }));
  const reply = await answerQuestion(root, 'Quero todos os passos para criar uma pipeline sem automação.', { client });
  assert.equal(reply.fallback, undefined);
  assert.deepEqual(reply.steps.map(({ text }) => text), mandatory);
  assert.equal(calls.answer, 2);
  assert.ok(hasReview(calls.requests[1], 'composition', 'plan_conflict'));
});
test('recuperação: router e feedback ficam isolados entre duas invocações/pessoas', async () => {
  const { client, calls } = fake((request, pass) => pass % 2 ? conflictBody : recoveredBody);
  for (const person of ['Quero entender o quadro.', 'Já tenho uma pipeline.']) {
    const reply = await answerQuestion(root, conceptual, { client, history: [{ role: 'user', content: person }] });
    assert.equal(reply.answer, recoveredBody.answer);
    assert.equal(reply.fallback, undefined);
  }
  assert.equal(calls.answer, 4);
  assert.equal(calls.triage, 2);
  assert.equal(calls.safety, 2);
  assert.ok(hasReview(calls.requests[1], 'composition', 'plan_conflict'));
  assert.ok(hasReview(calls.requests[3], 'composition', 'plan_conflict'));
  assert.equal(reviewOf(calls.requests[0]).includes('REVISÃO INTERNA'), false);
  assert.equal(reviewOf(calls.requests[2]).includes('REVISÃO INTERNA'), false);
});
test('recuperação: caminho normal não ganha chamada nem feedback e prompt não manda revelar origem', async () => {
  const { client, calls } = fake(recoveredBody);
  const reply = await answerQuestion(root, conceptual, { client });
  assert.equal(reply.answer, recoveredBody.answer);
  assert.equal(calls.answer, 1);
  assert.equal(calls.triage, 1);
  assert.equal(calls.safety, 0);
  assert.equal(reviewOf(calls.requests[0]).includes('REVISÃO INTERNA'), false);
  assert.doesNotMatch(reviewOf(calls.requests[0]), /Diga o que a documentação permite afirmar/u);
});
test('recuperação: classifier inválido é técnico, sem segunda geração', async () => {
  await withBusiness(async () => {
    const { client, calls } = fake(recoveredBody, { safety: [{}] });
    const reply = await answerQuestion(root, conceptual, { client });
    assert.deepEqual(reply.fallback, { branch: 'classifier', reason: 'invalid', pass: 1 });
    assert.equal(calls.answer, 1);
    assert.equal(calls.safety, 1);
  });
});
