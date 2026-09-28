import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFreeFaqSections } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const sha = 'a'.repeat(40);
const facts = [
  { kind: 'route', text: 'Robôs', source: 'src/Fixture.tsx:1', sha },
  { kind: 'action', text: 'Criar novo robô', source: 'src/Fixture.tsx:2', sha },
  { kind: 'action', text: 'Publicar', source: 'src/Fixture.tsx:3', sha },
  { kind: 'action', text: 'Excluir Selecionados', source: 'src/Fixture.tsx:4', sha },
];
const context = { request: { topic: 'Robô', module: 'Robôs',
  description: 'Criar FAQ para criar e ativar um robô.' }, screenFacts: facts };
const step = { tarefa: 'Criar', passos: [{ text: 'Clique em **Criar novo robô**.' }] };

test('destrutivo só dentro de rótulo de tela em todas as seções', () => {
  for (const key of ['oQueE', 'paraQueServe', 'casosDeUso', 'duvidas', 'erros', 'suporte', 'passos']) {
    const withText = (text) => key === 'passos'
      ? { passos: [{ tarefa: 'Criar', passos: [{ text }] }] }
      : { passos: [step], [key]: [{ text }] };
    const positive = validateFreeFaqSections(withText('Clique em **Excluir Selecionados**.'), context);
    assert.equal(key === 'passos' ? positive.sections.passos.length : positive.sections[key].length, 1, key);
    for (const text of ['Clique em **Criar novo robô** e exclua sua conta.',
      'Clique em **Criar novo robô** e destrua sua conta.']) {
      const negative = validateFreeFaqSections(withText(text), context);
      assert.equal(key === 'passos' ? negative.sections.passos.length : negative.sections[key].length, 0, `${key}: ${text}`);
      assert.ok(negative.pending.some((item) => item.includes('ação destrutiva fora de rótulo da tela')), `${key}: ${text}`);
    }
  }
  const heading = validateFreeFaqSections({ passos: [{ tarefa: 'Excluir conta', passos: [step.passos[0]] }] }, context);
  assert.equal(heading.sections.passos.length, 0);
  assert.ok(heading.pending.some((item) => item.includes('ação destrutiva fora de rótulo da tela')));
});

test('fluxo livre exige subseção com passo para cada tarefa pedida e com fato', async () => {
  const productContext = { groundingRequired: true, pending: [], coverage: [],
    support: { categories: [], rules: [] }, businessContext: [], faqStyleExamples: [],
    screenFacts: facts, code: [{ available: true, role: 'frontend',
      repository: 'ihelpchat/front-react', ref: sha }],
    matches: [{ repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', line: 2,
      sha, ref: sha, excerpt: '2: Criar novo robô' }] };
  const makeReply = (includeActivation) => ({ status: 'ready', summary: 'FAQ.', questions: [], articles: [{
    path: 'docs/teste/robo-novo', title: 'Robô novo', description: 'Ajuda para criar e ativar robô.',
    source: 'produto', contentType: 'faq', productActions: [], assistantQuestion: 'Como criar um robô?',
    sections: { oQueE: [{ text: 'O robô ajuda a organizar as conversas recebidas pela equipe de atendimento. '.repeat(8) }],
      paraQueServe: [], casosDeUso: [], duvidas: [], erros: [], suporte: [],
      passos: [step, ...(includeActivation ? [{ tarefa: 'Ativar',
        passos: [{ text: 'Clique em **Publicar**.' }] }] : [])] },
  }] });
  const run = async (includeActivation) => {
    const prompts = [];
    const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
      context.request, { productContext, plan: { status: 'ready' },
        client: { responses: { create: async (payload) => {
          const name = payload.text.format.name;
          if (name === 'juiz_faq') {
            const claims = JSON.parse(payload.input[1].content).claims;
            return { model: 'fixture', output_text: JSON.stringify({ claims: claims.map(({ id }) =>
              ({ id, status: 'sustentada', reason: '' })) }) };
          }
          prompts.push(JSON.stringify(payload.input));
          return { model: 'fixture', output_text: JSON.stringify(makeReply(includeActivation)) };
        } } } });
    return { result, prompts };
  };
  const positive = await run(true);
  assert.equal(positive.result.status, 'ready', JSON.stringify(positive.result.questions));
  assert.match(positive.result.articles[0].body, /### Ativar[\s\S]*\*\*Publicar\*\*/u);
  const negative = await run(false);
  assert.equal(negative.prompts.length, 2);
  assert.match(negative.prompts[1], /tarefa sem passo: ativar/u);
  assert.ok(negative.result.pending.some((item) => item.includes('tarefa sem passo: ativar')));
  assert.doesNotMatch(negative.result.articles[0]?.body ?? '', /### Ativar/u);
});
