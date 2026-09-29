import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFreeFaqSections, judgeClaims, renderFreeFaqSections } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';
import { mentionsSource } from './source-mention.mjs';

const context = { request: { topic: 'Robô', module: 'Robôs' }, screenFacts: [], existing: [] };
const sections = (text) => ({ oQueE: [{ text }], passos: [{ tarefa: 'Ativar', passos: [{ text: 'Clique em **Publicar**.' }] }] });

test('informações disponíveis distinguem lugar do produto de material e atribuição', () => {
  const cases = [
    ['consultar as informações disponíveis na ficha', false],
    ['As informações disponíveis no documento interno indicam que o robô recebe o cliente.', true],
    ['As informações disponíveis não explicam o robô.', true],
    ['Os dados disponíveis mostram que o robô recebe o cliente.', true],
    ['as informações disponíveis no iHelp', false],
    ['Consulta os dados disponíveis neste endpoint público.', false],
    ['o que está disponível no painel', false],
    ['o que está disponível no material indica que o robô responde.', true],
  ];
  for (const [phrase, expected] of cases) {
    assert.equal(mentionsSource(phrase), expected, phrase);
  }
  for (const place of ['ficha', 'contato', 'tela', 'módulo', 'iHelp', 'painel', 'atendimento', 'conversa']) {
    assert.equal(mentionsSource(`as informações disponíveis no ${place}`), false, place);
  }
  for (const material of ['documento', 'material', 'contexto', 'conteúdo', 'fonte', 'arquivo',
    'base', 'texto', 'anotações', 'referência']) {
    assert.equal(mentionsSource(`os dados disponíveis no ${material}`), true, material);
  }
  for (const verb of ['indicam que', 'mostram que', 'dizem que', 'apontam que']) {
    assert.equal(mentionsSource(`as informações disponíveis ${verb} o robô responde.`), true, verb);
  }
});

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
    'Não foi informado como o robô responde.',
  ];
  for (const phrase of rejected) {
    assert.equal(mentionsSource(phrase), true, phrase);
    const checked = validateFreeFaqSections(sections(phrase), context);
    assert.equal(checked.sections.oQueE.length, phrase.includes(',') ? 1 : 0, phrase);
    if (phrase.includes(',')) assert.equal(checked.sections.oQueE[0].text, 'O robô recebe o cliente.', phrase);
    assert.doesNotMatch(renderFreeFaqSections(checked.sections), /conteúdo fornecido|material enviado|informações disponíveis/iu);
  }
  for (const phrase of [
    'Conforme o plano contratado, o limite muda.',
    'Segundo passo: clique em **Salvar**.',
    'De acordo com o horário de atendimento configurado, o robô responde fora do expediente.',
    'Retorna os dados detalhados de um contato a partir do seu identificador de referência.',
  ]) {
    assert.equal(mentionsSource(phrase), false, phrase);
    assert.equal(validateFreeFaqSections(sections(phrase), { ...context,
      screenFacts: [{ kind: 'action', text: 'Salvar' }] }).sections.oQueE.length, 1, phrase);
  }
});

test('atribuições por radical cobrem flexões e determinantes', () => {
  const materials = [
    ['informação', 'informações'], ['documento', 'documentos'], ['material', 'materiais'],
    ['conteúdo', 'conteúdos'], ['texto', 'textos'], ['fonte', 'fontes'],
    ['contexto', 'contextos'], ['dado', 'dados'], ['arquivo', 'arquivos'],
    ['trecho', 'trechos'], ['anotação', 'anotações'], ['referência', 'referências'],
    ['descrição', 'descrições'], ['leitura', 'leituras'],
  ];
  const participles = [
    ['fornecido', 'fornecida', 'fornecidos', 'fornecidas'],
    ['disponibilizado', 'disponibilizada', 'disponibilizados', 'disponibilizadas'],
    ['recebido', 'recebida', 'recebidos', 'recebidas'],
    ['informado', 'informada', 'informados', 'informadas'],
    ['apresentado', 'apresentada', 'apresentados', 'apresentadas'],
    ['enviado', 'enviada', 'enviados', 'enviadas'],
    ['consultado', 'consultada', 'consultados', 'consultadas'],
    ['compartilhado', 'compartilhada', 'compartilhados', 'compartilhadas'],
  ];
  for (const forms of materials) for (const form of forms) {
    const phrase = `Segundo ${form}, o robô recebe o cliente.`;
    assert.equal(mentionsSource(phrase), true, phrase);
  }
  for (const forms of participles) for (const form of forms) {
    const phrase = `Conforme ${form}, o robô recebe o cliente.`;
    assert.equal(mentionsSource(phrase), true, phrase);
  }
  for (const phrase of [
    'Segundo a informação recebida, o robô recebe o cliente.',
    'Conforme os documentos enviados, o robô recebe o cliente.',
    'Conforme este documento, o robô recebe o cliente.',
    'Segundo as informações recebidas, o robô recebe o cliente.',
  ]) {
    assert.equal(mentionsSource(phrase), true, phrase);
    assert.deepEqual(validateFreeFaqSections(sections(phrase), context).sections.oQueE,
      [{ text: 'O robô recebe o cliente.' }], phrase);
  }
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

test('juiz ignora rewrite inventado e remove somente atribuição destacável', async () => {
  const originals = [
    'A leitura de apoio mostra que o robô recebe o cliente.',
    'Segundo a informação recebida, o robô recebe o cliente.',
    'Conforme os documentos enviados, o robô recebe o cliente.',
    'O que li para gerar esta resposta diz que o robô responde.',
  ];
  const input = { ...sections(originals[0]), oQueE: originals.map((text) => ({ text })) };
  const judged = await judgeClaims(input, { ...context, business: [{ module: 'Robôs' }] }, async (claims) => ({
    claims: claims.map((claim) => ({ id: claim.id, status: claim.text.includes('informação') ? 'a confirmar' : 'sustentada',
      reason: 'fonte insuficiente', sourceMention: claim.section === 'oQueE',
      rewrite: 'O robô cobra cem reais por conversa.' })),
  }));
  const page = renderFreeFaqSections(judged.sections);
  assert.doesNotMatch(page, /cem reais|leitura de apoio|documentos enviados|o que li/iu);
  assert.deepEqual(judged.sections.oQueE, [
    { text: 'O robô recebe o cliente.' },
    { text: '<AConfirmar>O robô recebe o cliente.</AConfirmar>' },
    { text: 'O robô recebe o cliente.' },
  ]);
  assert.match(judged.pending.join(' '), /frase omitida: mencionava a fonte/u);
});

test('replay do revisor: remove atribuição ao contexto em O que é', () => {
  const result = validateFreeFaqSections(sections('Segundo o contexto, o robô recebe o cliente.'), context);
  assert.deepEqual(result.sections.oQueE, [{ text: 'O robô recebe o cliente.' }]);
  assert.match(result.pending.join(' '), /menção à fonte/u);
});

test('omite variantes com acento, caixa e nome do arquivo, preserva frase normal', () => {
  for (const phrase of ['Conforme o CONTEXTO de negócio, o robô responde.',
    'De acordo com o contexto, o robô responde.', 'Segundo o material, o robô responde.',
    'Segundo a fonte, o robô responde.', 'Conforme a documentação interna, o robô responde.',
    'O segundo cérebro descreve o robô.', 'O arquivo robos.md descreve o robô.',
    'Leia business-context para entender o robô.']) {
    const result = validateFreeFaqSections(sections(phrase), context);
    assert.equal(result.sections.oQueE.length, phrase.includes(',') ? 1 : 0, phrase);
    assert.match(result.pending.join(' '), /menção à fonte|mencionava a fonte/u);
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
