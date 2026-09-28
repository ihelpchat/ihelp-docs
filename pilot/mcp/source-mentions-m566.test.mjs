import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFreeFaqSections, judgeClaims, renderFreeFaqSections } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';
import { mentionsSource } from './source-mention.mjs';

const context = { request: { topic: 'Robô', module: 'Robôs' }, screenFacts: [], existing: [] };
const sections = (text) => ({ oQueE: [{ text }], passos: [{ tarefa: 'Ativar', passos: [{ text: 'Clique em **Publicar**.' }] }] });

test('atribuição gramatical é recusada nas saídas públicas sem bloquear linguagem comum', () => {
  const rejected = [
    'Segundo o conteúdo fornecido, o robô recebe o cliente.',
    'Conforme o material enviado, o robô recebe o cliente.',
    'De acordo com as informações disponíveis, o robô recebe o cliente.',
    'Com base no contexto, o robô recebe o cliente.',
    'A partir dos dados apresentados, o robô recebe o cliente.',
    'Pelo que consta em um documento consultado, o robô recebe o cliente.',
    'Como descrito em texto recebido, o robô recebe o cliente.',
    'Não há informação sobre o robô.',
    'As informações disponíveis não explicam o robô.',
    'Não foi informado como o robô responde.',
  ];
  for (const phrase of rejected) {
    assert.equal(mentionsSource(phrase), true, phrase);
    const checked = validateFreeFaqSections(sections(phrase), context);
    assert.deepEqual(checked.sections.oQueE, [], phrase);
    assert.doesNotMatch(renderFreeFaqSections(checked.sections), /conteúdo fornecido|material enviado|informações disponíveis/iu);
  }
  for (const phrase of [
    'Conforme o plano contratado, o limite muda.',
    'Segundo passo: clique em **Salvar**.',
    'De acordo com o horário de atendimento configurado, o robô responde fora do expediente.',
  ]) assert.equal(mentionsSource(phrase), false, phrase);
});

test('juiz semântico reescreve uma vez e omite atribuição persistente, sem nova chamada', async () => {
  const input = { ...sections('A leitura de apoio mostra que o robô recebe o cliente.'),
    duvidas: [{ text: 'O que li para gerar esta resposta diz que o robô responde.' }] };
  let calls = 0;
  const judged = await judgeClaims(input, { ...context, business: [{ module: 'Robôs' }] }, async (claims) => {
    calls++;
    return { claims: claims.map((claim) => ({ id: claim.id, status: 'sustentada', reason: '',
      sourceMention: claim.section === 'oQueE' || claim.section === 'duvidas',
      rewrite: claim.section === 'oQueE' ? 'O robô recebe o cliente.'
        : claim.section === 'duvidas' ? 'Conforme o material enviado, o robô responde.' : '' })) };
  });
  assert.equal(calls, 1);
  assert.deepEqual(judged.sections.oQueE, [{ text: 'O robô recebe o cliente.' }]);
  assert.deepEqual(judged.sections.duvidas, []);
  assert.match(judged.pending.join(' '), /menção à fonte/u);
  assert.doesNotMatch(renderFreeFaqSections(judged.sections), /leitura de apoio|o que li|material enviado/iu);
});

test('replay do revisor: omite atribuição ao contexto em O que é', () => {
  const result = validateFreeFaqSections(sections('Segundo o contexto, o robô recebe o cliente.'), context);
  assert.deepEqual(result.sections.oQueE, []);
  assert.match(result.pending.join(' '), /menção à fonte/u);
});

test('omite variantes com acento, caixa e nome do arquivo, preserva frase normal', () => {
  for (const phrase of ['Conforme o CONTEXTO de negócio, o robô responde.',
    'De acordo com o contexto, o robô responde.', 'Segundo o material, o robô responde.',
    'Segundo a fonte, o robô responde.', 'Conforme a documentação interna, o robô responde.',
    'O segundo cérebro descreve o robô.', 'O arquivo robos.md descreve o robô.',
    'Leia business-context para entender o robô.']) {
    const result = validateFreeFaqSections(sections(phrase), context);
    assert.deepEqual(result.sections.oQueE, [], phrase);
    assert.match(result.pending.join(' '), /menção à fonte/u);
  }
  assert.equal(validateFreeFaqSections(sections('O robô recebe o cliente.'), context).sections.oQueE.length, 1);
});

test('subtítulo e assistantQuestion com fonte disparam retry e não chegam à página', async () => {
  const request = { topic: 'Robô', module: 'Robôs', description: 'Criar FAQ para criar robô.' };
  const productContext = { groundingRequired: true, pending: [], coverage: [], support: { categories: [], rules: [] },
    businessContext: [], faqStyleExamples: [], screenFacts: [{ kind: 'action', text: 'Criar novo robô', source: 'src/Fixture.tsx:2' }],
    code: [{ available: true, role: 'frontend', repository: 'ihelpchat/front-react', ref: 'a'.repeat(40) }], matches: [] };
  let generated = 0;
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname, request,
    { productContext, plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      if (payload.text.format.name === 'juiz_faq') {
        const { claims } = JSON.parse(payload.input[1].content);
        return { model: 'fixture', output_text: JSON.stringify({ claims: claims.map(({ id }) =>
          ({ id, status: 'sustentada', reason: '' })) }) };
      }
      generated++;
      if (generated === 2) assert.match(JSON.stringify(payload.input), /menção à fonte/u);
      return { model: 'fixture', output_text: JSON.stringify({ status: 'ready', summary: 'FAQ.', questions: [],
        articles: [{ path: 'docs/teste/robo-novo', title: 'Robô novo',
          description: 'Conforme o contexto de negócio, o robô atende.', source: 'produto', contentType: 'faq',
          productActions: [], assistantQuestion: 'Segundo o contexto, como criar um robô?',
          sections: { oQueE: [{ text: 'Segundo o contexto, o robô recebe o cliente.' },
            { text: 'O robô organiza as conversas que chegam para a equipe. Você pode preparar uma mensagem de abertura, escolher uma opção para cada pedido e conferir o fluxo antes de publicar. Quando a equipe precisar mudar a orientação, abra o robô, ajuste a mensagem e salve. Depois, confira a experiência pelo mesmo caminho que o cliente vai usar.' }],
            paraQueServe: [], casosDeUso: [], duvidas: [], erros: [], suporte: [],
            passos: [{ tarefa: 'Criar', passos: [{ text: 'Clique em **Criar novo robô**.' }] }] } }] }) };
    } } } });
  assert.equal(generated, 2);
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.doesNotMatch(JSON.stringify(result.articles), /segundo o contexto|conforme o contexto|contexto de negócio/iu);
  assert.match(result.pending.join(' '), /menção à fonte/u);
});
