// Caller-visible guard regressions from review 035569a. Fake clients only: no inference-quality claim.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const owned = await mkdtemp(join(tmpdir(), 'claricia-speech-acts-'));
const businessBefore = process.env.BUSINESS_CONTEXT_DIR;
delete process.env.BUSINESS_CONTEXT_DIR;
after(async () => {
  if (businessBefore === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
  else process.env.BUSINESS_CONTEXT_DIR = businessBefore;
  await rm(owned, { recursive: true, force: true });
});
const path = '/docs/principais-motivos-de-suporte/crm';
const tutorial = '/docs/sobre-o-sistema/crm/como-criar-uma-nova-pipeline';
const crm = (await retrieveContext(root, 'Como criar pipeline no CRM?', 8)).find((source) => source.path === path);
assert.equal(crm.documentedSteps.length, 16);
const step = (text) => ({ text, actionId: null, imagePath: null });
const history = [
  { role: 'user', content: 'Como criar uma pipeline no CRM? Quero ler o caminho todo antes de começar.' },
  { role: 'assistant', content: `Siga o fluxo para criar o quadro; a automação é opcional.\n${crm.documentedSteps.map((text, i) => `${i + 1}. ${text}`).join('\n')}\nFonte usada: ${path}\nFonte usada: ${tutorial}` },
  { role: 'user', content: 'Qual a diferença entre Pública, Departamento e Privada?' },
  { role: 'assistant', content: `A visibilidade define quem pode ver a pipeline.\nFonte usada: ${tutorial}` },
];
let invocation = 0;
async function ask({ intent = 'confirm_completion', answer = 'A pipeline aparece na lista.', sections = [], suggestions = [], optionalBranch = 'unspecified', steps = [], question, withHistory = true, code = null, sources = [path] }) {
  const calls = { router: 0, generation: 0, classifier: 0 };
  const client = { responses: { create: async (request) => {
    const name = request.text?.format?.name;
    let body;
    if (name === 'triagem_fechada') { calls.router++; body = { choice: 'sem guia' }; }
    else if (name === 'seguranca_resposta') { calls.classifier++; body = { mentionsSource: false, unsupportedAction: false }; }
    else { calls.generation++; body = { plan: { intent, optionalBranch }, answer, sections, suggestions, steps,
      sources, code, resolution: 'complete', found: true }; }
    return { status: 'completed', model: 'speech-act-fixture', usage: { input_tokens: 1, output_tokens: 1 }, output_text: JSON.stringify(body) };
  } } };
  const reply = await answerQuestion(root, question ?? (intent === 'clarify' ? 'Não sei qual é a tela. Pode me ajudar?' : 'Terminei de criar. Como sei se deu certo? O robô já começa a responder?'),
    { client, history: withHistory ? history : [], budget: { file: join(owned, `${++invocation}.json`), dailyLimitUsd: 100, reserveUsd: 0.05, inputUsdPerMillion: 0, outputUsdPerMillion: 0 } });
  assert.equal(calls.generation, 1, 'guard correction never adds another generation');
  return reply;
}

for (const [intent, answer] of [
  ['clarify', 'Informe o nome da tela que está aberta.'],
  ['clarify', 'Diga o texto do aviso que aparece na tela.'],
  ['confirm_completion', 'Confirme se a pipeline aparece na lista.'],
  ['confirm_completion', 'Verifique se o quadro aparece com os estágios escolhidos.'],
]) {
  test(`information/inspection survives: ${answer}`, async () => {
    const reply = await ask({ intent, answer });
    assert.equal(reply.answer, answer);
    assert.deepEqual(reply.steps, []);
    assert.equal(reply.fallback, undefined);
  });
}

const fields = ['answer', 'section', 'suggestion'];
for (const field of fields) {
  for (const text of [
    'Confira a lista e clique em Nova Pipeline.',
    'Confirme se o quadro aparece; depois, publique o robô.',
    'Verifique a lista. Crie uma nova pipeline.',
    'Clique em Nova Pipeline?',
    'Confira a lista e agora clique em Nova Pipeline.',
    'Informe no campo Nome o texto da pipeline.',
  ]) {
    test(`compound execution blocked in ${field}: ${text}`, async () => {
      const input = field === 'answer' ? { answer: text } : field === 'section'
        ? { sections: [{ title: 'Conferência', items: [text] }] } : { suggestions: [text] };
      const reply = await ask(input);
      assert.equal(reply.fallback?.reason, 'plan_conflict');
      assert.deepEqual(reply.steps, []);
      assert.deepEqual(reply.sections, []);
      assert.deepEqual(reply.suggestions, []);
      assert.notEqual(reply.answer, text);
    });
  }
}

for (const suggestions of [
  ['Como publico o robô quando estiver pronto?'],
  ['Quero criar outra pipeline depois'],
]) {
  test(`future conversational choice survives: ${suggestions[0]}`, async () => {
    const reply = await ask({ suggestions });
    assert.deepEqual(reply.suggestions, suggestions);
    assert.equal(reply.fallback, undefined);
    assert.deepEqual(reply.steps, []);
  });
}
for (const suggestion of ['Como publico o robô? Clique em Nova Pipeline.', 'Quero criar outra e clique em Nova Pipeline?']) {
  test(`future choice cannot hide an imperative: ${suggestion}`, async () => {
    assert.equal((await ask({ suggestions: [suggestion] })).fallback?.reason, 'plan_conflict');
  });
}

for (const answer of ['Não clique em Nova Pipeline.', 'Confira a lista e não clique em Nova Pipeline.', 'Confirme se a pipeline aparece; não publique o robô agora.', 'Confirme se a pipeline aparece; agora não clique em Nova Pipeline.']) {
  test(`negated execution survives without becoming an operation: ${answer}`, async () => {
    const reply = await ask({ answer });
    assert.equal(reply.answer, answer);
    assert.equal(reply.fallback, undefined);
    assert.deepEqual(reply.steps, []);
  });
}
test('negation does not cover a following affirmative command', async () => {
  assert.equal((await ask({ answer: 'Não clique em Nova Pipeline; publique o robô agora.' })).fallback?.reason, 'plan_conflict');
});

for (const optionalBranch of ['unspecified', 'include']) {
  for (const answer of ['Siga os passos abaixo. Se preferir, pule a automação.', 'Siga os passos abaixo. Pule a etapa opcional se quiser.', 'Siga os passos abaixo. Não pule a automação.']) {
    test(`optional alternative/negation preserves the full source (${optionalBranch}): ${answer}`, async () => {
      const reply = await ask({ intent: 'execute', optionalBranch, answer, steps: crm.documentedSteps.map(step), question: 'Quero ver todos os passos para criar uma pipeline.', withHistory: false });
      assert.equal(reply.answer, answer);
      assert.deepEqual(reply.steps.map(({ text }) => text), crm.documentedSteps);
      assert.equal(reply.fallback, undefined);
    });
  }
}
for (const optionalBranch of ['unspecified', 'include']) {
  test(`unconditional skip conflicts with ${optionalBranch}`, async () => {
    const reply = await ask({ intent: 'execute', optionalBranch, answer: 'Pule a automação.', steps: crm.documentedSteps.map(step), question: 'Quero ver todos os passos para criar uma pipeline.', withHistory: false });
    assert.equal(reply.fallback?.reason, 'plan_conflict');
    assert.deepEqual(reply.steps, []);
  });
}
test('real skip keeps every mandatory step and omits the optional branch', async () => {
  const reply = await ask({ intent: 'execute', optionalBranch: 'skip', answer: 'Siga sem a etapa opcional.', steps: crm.documentedSteps.map(step), question: 'Quero ver todos os passos para criar uma pipeline sem automação.', withHistory: false });
  const branch = crm.optionalBranch;
  assert.deepEqual(reply.steps.map(({ text }) => text), crm.documentedSteps.filter((_, i) => i <= branch.decision || i >= branch.decline));
  assert.equal(reply.fallback, undefined);
});


test('unrelated inspection does not make a preceding skip conditional', async () => {
  const reply = await ask({ intent: 'execute', answer: 'Pule a automação e confirme se a pipeline aparece na lista.', steps: crm.documentedSteps.map(step), question: 'Quero ver todos os passos para criar uma pipeline.', withHistory: false });
  assert.equal(reply.fallback?.reason, 'plan_conflict');
  assert.deepEqual(reply.steps, []);
});

// F1–F3: modal operation, referred result, and executable code share the same plan boundary.
for (const field of fields) {
  for (const verb of ['criar uma nova pipeline', 'configurar a automação', 'publicar o robô']) {
    test(`modal operation blocked in ${field}: ${verb}`, async () => {
      const text = `Você pode ${verb} agora para começar.`;
      const input = field === 'answer' ? { answer: text } : field === 'section'
        ? { sections: [{ title: 'Próximo passo', items: [text] }] } : { suggestions: [text] };
      const reply = await ask({ intent: 'clarify', ...input });
      assert.equal(reply.fallback?.reason, 'plan_conflict');
      assert.deepEqual(reply.steps, []);
      assert.deepEqual(reply.sections, []);
      assert.deepEqual(reply.suggestions, []);
      assert.notEqual(reply.answer, text);
    });
  }
}
for (const answer of [
  'Você pode ter vários cards do mesmo contato.',
  'Você quer entender a API ou criar um quadro?',
  'Você pode me dizer qual tela está aberta?',
  'Confira se a pipeline que você acabou de criar aparece na lista.',
]) {
  test(`factual/dialogue/referred result survives: ${answer}`, async () => {
    const reply = await ask({ answer });
    assert.equal(reply.answer, answer);
    assert.equal(reply.fallback, undefined);
    assert.deepEqual(reply.steps, []);
  });
}
for (const answer of [
  'Confira se a pipeline que você acabou de criar aparece na lista e clique em Nova Pipeline.',
  'Confira se a pipeline que você acabou de criar aparece na lista; você pode publicar o robô agora.',
]) {
  test(`referred result cannot hide another operation: ${answer}`, async () => {
    assert.equal((await ask({ answer })).fallback?.reason, 'plan_conflict');
  });
}
for (const intent of ['clarify', 'explain', 'confirm_completion']) {
  test(`execution code is absent for ${intent}`, async () => {
    const reply = await ask({ intent, answer: 'Você quer entender a API ou criar um quadro?',
      question: 'Como configurar o CRM pela API?', withHistory: false,
      code: { language: 'bash', content: 'curl -X POST https://example.invalid/create' } });
    assert.equal(reply.code, null);
    assert.deepEqual(reply.steps, []);
    assert.equal(reply.fallback, undefined);
  });
}
test('execute keeps a sourced API example with a token placeholder', async () => {
  const code = { language: 'bash', content: 'curl -H "Authorization: Bearer $IHELP_TOKEN" https://apiv3.ihelpchat.com/api/v2/crm/funnel' };
  const reply = await ask({ intent: 'execute', answer: 'Use a consulta de funis da API.',
    question: 'Como listar funis pela API? Quero um exemplo curl.', withHistory: false,
    sources: ['/api/crm/funis/listar-funis'], code });
  assert.deepEqual(reply.code, code);
  assert.equal(reply.fallback, undefined);
  assert.ok(reply.sources.some(({ path }) => path === '/api/crm/funis/listar-funis'));
});

// B1: the current explanatory plan owns capacity semantics; immediate operations retain their gate.
const capacity = 'Você pode criar vários cards para o mesmo contato quando a trava está desativada.';
for (const field of fields) {
  test(`explain preserves sourced capability in ${field}`, async () => {
    const input = field === 'answer' ? { answer: capacity } : field === 'section'
      ? { sections: [{ title: 'Capacidade', items: [capacity] }] } : { suggestions: [capacity] };
    const reply = await ask({ intent: 'explain', question: 'O mesmo contato pode ter vários cards na pipeline?', withHistory: false, ...input });
    assert.equal(reply.fallback, undefined);
    assert.deepEqual(reply.steps, []);
    assert.equal(reply.code, null);
    assert.ok(reply.sources.some((source) => source.path === path));
    if (field === 'answer') assert.equal(reply.answer, capacity);
    else if (field === 'section') assert.deepEqual(reply.sections, input.sections);
    else assert.deepEqual(reply.suggestions, input.suggestions);
  });
  for (const text of [
    'Você pode criar uma nova pipeline agora para começar.',
    capacity + ' Clique em Nova Pipeline.',
  ]) {
    test(`explain does not authorize an immediate/compound operation in ${field}: ${text}`, async () => {
      const input = field === 'answer' ? { answer: text } : field === 'section'
        ? { sections: [{ title: 'Capacidade', items: [text] }] } : { suggestions: [text] };
      const reply = await ask({ intent: 'explain', ...input });
      assert.equal(reply.fallback?.reason, 'plan_conflict');
      assert.deepEqual(reply.steps, []);
      assert.deepEqual(reply.sections, []);
      assert.deepEqual(reply.suggestions, []);
      assert.notEqual(reply.answer, text);
    });
  }
}
test('explain capacity does not require a conditional clause', async () => {
  const answer = 'Você pode criar vários cards para o mesmo contato com a trava desativada.';
  const reply = await ask({ intent: 'explain', answer, question: 'O mesmo contato pode ter vários cards na pipeline?', withHistory: false });
  assert.equal(reply.answer, answer);
  assert.equal(reply.fallback, undefined);
  assert.deepEqual(reply.steps, []);
  assert.equal(reply.code, null);
});
for (const answer of [
  'Agora, você pode criar uma nova pipeline.',
  'Você pode criar uma nova pipeline para começar.',
  'Você pode criar uma nova pipeline em seguida.',
  'Se quiser, você pode criar uma nova pipeline agora.',
  'Você deve criar uma nova pipeline.',
]) {
  test(`explain keeps current scope/deontic instruction blocked: ${answer}`, async () => {
    assert.equal((await ask({ intent: 'explain', answer })).fallback?.reason, 'plan_conflict');
  });
}
