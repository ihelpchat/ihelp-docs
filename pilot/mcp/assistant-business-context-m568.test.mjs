import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion } from './assistant-service.mjs';
import { topicForQuestion } from './closed-router.mjs';

const article = `---\ntitle: Carteira de contatos\ndescription: Entenda a carteira de contatos.\n---\nA carteira organiza contatos. Para criar uma carteira:\n1. Abra Contatos.\n`;
const response = (answer = 'A carteira organiza os contatos por responsável.') => ({
  model: 'fixture', status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
  output_text: JSON.stringify({ answer, sections: [], steps: [], code: null,
    sources: ['/docs/sobre-o-sistema/agenda-de-contatos'], suggestions: [], resolution: 'complete', found: true }),
});

test('contexto fictício de negócio apoia resposta sem virar fonte ou passo', async () => {
  assert.equal(topicForQuestion('Para que serve a carteira?'), 'importar-contatos');
  assert.equal(topicForQuestion('Como vejo o saldo da Minha Carteira Gupshup?'), undefined,
    'carteira de créditos não é carteira de contatos');
  const root = await mkdtemp(join(tmpdir(), 'claricia-m568-'));
  const directory = await mkdtemp(join(tmpdir(), 'claricia-business-m568-'));
  const previous = process.env.BUSINESS_CONTEXT_DIR;
  const requests = [];
  try {
    await mkdir(join(root, 'content/docs/docs/sobre-o-sistema'), { recursive: true });
    await writeFile(join(root, 'content/docs/docs/sobre-o-sistema/agenda-de-contatos.mdx'), article);
    await mkdir(join(root, 'content/docs/docs/whatsapp-business-api'), { recursive: true });
    await writeFile(join(root, 'content/docs/docs/whatsapp-business-api/carteira.mdx'),
      '---\ntitle: Minha Carteira\ndescription: Para que serve a carteira?\n---\nA carteira de créditos fictícios mostra o saldo.');
    await writeFile(join(directory, 'geral.md'), '🟢 PÚBLICO\nO produto fictício organiza equipes.');
    await writeFile(join(directory, 'contatos.md'), '🟢 PÚBLICO\nA carteira fictícia separa contatos por responsável. PASSO SECRETO: clique no botão invisível.');
    process.env.BUSINESS_CONTEXT_DIR = directory;
    const client = { responses: { create: async (payload) => { requests.push(payload);
      return payload.text.format.name === 'seguranca_resposta'
        ? { ...response(), output_text: JSON.stringify({ mentionsSource: false, unsupportedAction: false }) }
        : response(); } } };
    const result = await answerQuestion(root, 'Para que serve a carteira?', { client });
    assert.match(requests[0].input.at(-1).content, /carteira fictícia separa contatos por responsável/u);
    assert.match(requests[0].input.at(-1).content, /produto fictício organiza equipes/u);
    assert.doesNotMatch(requests[0].input.at(-1).content, /carteira de créditos fictícios/u,
      'triagem de carteira de contatos não mistura carteira de créditos');
    assert.match(requests[0].input[0].content, /Instruções de ação.*PASSOS DOCUMENTADOS.*FAQ/iu);
    assert.equal(result.answer, 'A carteira organiza os contatos por responsável.');
    assert.deepEqual(result.sources.map(({ path }) => path), ['/docs/sobre-o-sistema/agenda-de-contatos']);
    assert.equal(result.businessContextUsed, true);
    assert.equal(JSON.stringify(result).includes('businessContextUsed'), false, 'campo interno não sai na API');
    assert.equal(result.steps.length, 0);

    const inventedStep = await answerQuestion(root, 'Para que serve a carteira?', { client: {
      responses: { create: async (payload) => payload.text.format.name === 'seguranca_resposta'
        ? { ...response(), output_text: JSON.stringify({ mentionsSource: false, unsupportedAction: false }) }
        : ({ ...response(), output_text: JSON.stringify({
        answer: 'A carteira organiza contatos.', sections: [], steps: [{ text: 'Clique no botão invisível.' }],
        code: null, sources: ['/docs/sobre-o-sistema/agenda-de-contatos'], suggestions: [],
        resolution: 'complete', found: true,
      }) }) },
    } });
    assert.deepEqual(inventedStep.steps, [], 'material de negócio não autoriza passos inventados');

    const grounded = await answerQuestion(root, 'Para que serve a carteira?', { client: {
      responses: { create: async (payload) => payload.text.format.name === 'seguranca_resposta'
        ? { ...response(), output_text: JSON.stringify({ mentionsSource: false, unsupportedAction: false }) }
        : { ...response(), output_text: JSON.stringify({
          answer: 'A carteira organiza contatos.', sections: [], steps: [
            { text: 'Abra Contatos.', sourceStepId: 'faq-1-step-1', actionId: null, imagePath: null },
            { text: 'Clique no botão invisível.', sourceStepId: 'faq-1-step-1', actionId: null, imagePath: null },
            { text: 'Abra Contatos.', sourceStepId: 'faq-9-step-1', actionId: null, imagePath: null },
          ], code: null, sources: ['/docs/sobre-o-sistema/agenda-de-contatos'], suggestions: [],
          resolution: 'complete', found: true,
        }) },
    } } });
    assert.deepEqual(grounded.steps.map(({ text }) => text), ['Abra Contatos.'],
      'ID real e texto idêntico são necessários; ID inventado ou texto alterado cai');

    const leaking = await answerQuestion(root, 'Para que serve a carteira?', { client: {
      responses: { create: async (payload) => payload.text.format.name === 'seguranca_resposta'
        ? { ...response(), output_text: JSON.stringify({ mentionsSource: true, unsupportedAction: false }) }
        : response('Segundo o contexto do arquivo contatos.md, a carteira organiza contatos.') },
    } });
    assert.doesNotMatch(JSON.stringify(leaking), /segundo o contexto|contatos\.md|business-context/iu,
      'mutação que cita a fonte deve falhar');
    assert.equal(leaking.businessContextUsed, undefined);

    delete process.env.BUSINESS_CONTEXT_DIR;
    const without = await answerQuestion(root, 'Para que serve a carteira?', { client });
    assert.equal(without.answer, result.answer);
    assert.equal(without.businessContextUsed, undefined);
    assert.doesNotMatch(requests.findLast((item) => item.text.format.name === 'resposta_documentacao').input.at(-1).content, /produto fictício|carteira fictícia/u);
    assert.match(requests.findLast((item) => item.text.format.name === 'resposta_documentacao').input.at(-1).content, /carteira de créditos fictícios/u,
      'sem contexto a recuperação conserva as fontes anteriores');
    process.env.BUSINESS_CONTEXT_DIR = join(root, 'missing');
    const missing = await answerQuestion(root, 'Para que serve a carteira?', { client });
    assert.deepEqual(missing, without);
    process.env.BUSINESS_CONTEXT_DIR = directory;
    await mkdir(join(root, 'content/docs/docs/teste'), { recursive: true });
    await writeFile(join(root, 'content/docs/docs/teste/tema.mdx'), '---\ntitle: Tema abstrato\n---\nTema abstrato do produto.');
    await answerQuestion(root, 'O que é o tema abstrato?', { client });
    assert.match(requests.findLast((item) => item.text.format.name === 'resposta_documentacao').input.at(-1).content, /produto fictício organiza equipes/u);
    assert.doesNotMatch(requests.findLast((item) => item.text.format.name === 'resposta_documentacao').input.at(-1).content, /carteira fictícia separa contatos/u,
      'sem módulo identificado, entra só geral.md');
  } finally {
    if (previous === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = previous;
    await rm(root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('contexto grande é cortado dentro da mesma reserva de custo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claricia-m568-'));
  const directory = await mkdtemp(join(tmpdir(), 'claricia-business-m568-'));
  const previous = process.env.BUSINESS_CONTEXT_DIR;
  try {
    await mkdir(join(root, 'content/docs/docs/sobre-o-sistema'), { recursive: true });
    await writeFile(join(root, 'content/docs/docs/sobre-o-sistema/agenda-de-contatos.mdx'), article);
    await writeFile(join(directory, 'geral.md'), `🟢 PÚBLICO\n${'Regra fictícia de negócio. '.repeat(2000)}`);
    await writeFile(join(directory, 'contatos.md'), `🟢 PÚBLICO\n${'Carteira fictícia separa contatos. '.repeat(2000)}`);
    process.env.BUSINESS_CONTEXT_DIR = directory;
    let calls = 0;
    const client = { responses: { create: async (payload) => {
      if (payload.text.format.name === 'seguranca_resposta') return { ...response(),
        output_text: JSON.stringify({ mentionsSource: false, unsupportedAction: false }) };
      calls++;
      const prompt = payload.input.at(-1).content;
      assert.ok(prompt.length < 20_000);
      assert.match(prompt, /Regra fictícia de negócio/u, 'geral.md não pode ser cortado por um módulo grande');
      return response();
    } } };
    const admitted = await answerQuestion(root, 'Para que serve a carteira?', { client,
      budget: { file: join(root, 'admitted.json'), dailyLimitUsd: 100, reserveUsd: 1 } });
    assert.equal(calls, 1, 'o texto cortado chega ao modelo');
    assert.equal(admitted.businessContextUsed, true);
    calls = 0;
    const result = await answerQuestion(root, 'Para que serve a carteira?', { client,
      budget: { file: join(root, 'budget.json'), dailyLimitUsd: 0, reserveUsd: 1 } });
    assert.equal(calls, 0, 'contexto participa do teto de custo existente');
    assert.equal(result.businessContextUsed, undefined);
  } finally {
    if (previous === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = previous;
    await rm(root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test('atribuição indireta e instrução sem lastro não chegam ao cliente', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claricia-m568-'));
  const directory = await mkdtemp(join(tmpdir(), 'claricia-business-m568-'));
  const previous = process.env.BUSINESS_CONTEXT_DIR;
  try {
    await mkdir(join(root, 'content/docs/docs/sobre-o-sistema'), { recursive: true });
    await writeFile(join(root, 'content/docs/docs/sobre-o-sistema/agenda-de-contatos.mdx'), article);
    await writeFile(join(directory, 'geral.md'), '🟢 PÚBLICO\nProduto fictício.');
    await writeFile(join(directory, 'contatos.md'), '🟢 PÚBLICO\nPASSO SECRETO: clique no botão invisível.');
    process.env.BUSINESS_CONTEXT_DIR = directory;
    for (const answer of [
      'Segundo o material de apoio, a carteira separa os contatos.',
      'Clique no botão invisível para separar os contatos.',
    ]) {
      let answers = 0;
      let checks = 0;
      const client = { responses: { create: async (payload) => {
        if (payload.text.format.name === 'seguranca_resposta') {
          checks++;
          return { ...response(), output_text: JSON.stringify({ mentionsSource: answers === 1 && answer.startsWith('Segundo'),
            unsupportedAction: answers === 1 && answer.startsWith('Clique') }) };
        }
        answers++;
        return response(answers === 1 ? answer : 'A carteira organiza os contatos.');
      } } };
      const result = await answerQuestion(root, 'Para que serve a carteira?', { client });
      assert.equal(result.answer, 'A carteira organiza os contatos.');
      assert.equal(result.businessContextUsed, undefined);
      assert.equal(answers, 2, 'refaz uma vez sem contexto');
      assert.equal(checks, 2, 'classifica também a resposta refeita');
    }
    let answerCalls = 0;
    const failedClassifier = await answerQuestion(root, 'Para que serve a carteira?', { client: {
      responses: { create: async (payload) => {
        if (payload.text.format.name === 'seguranca_resposta') throw Error('classificador indisponível');
        answerCalls++;
        return response('A carteira organiza os contatos.');
      } },
    } });
    assert.equal(answerCalls, 2, 'falha do classificador provoca uma única tentativa sem contexto');
    assert.match(failedClassifier.answer, /guia abaixo|Tive um problema/iu);
    assert.equal(failedClassifier.businessContextUsed, undefined);
  } finally {
    if (previous === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = previous;
    await rm(root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
