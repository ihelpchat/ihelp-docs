import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateFreeFaqSections, judgeClaims, renderFreeFaqSections } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const sha = 'a'.repeat(40);
const facts = [
  { kind: 'route', text: 'Robôs', repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', lineStart: 1, lineEnd: 1, sha },
  { kind: 'action', text: 'Criar novo robô', repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', lineStart: 2, lineEnd: 2, sha },
];
const sections = {
  oQueE: [{ text: 'O robô recebe a primeira mensagem do cliente.' }],
  paraQueServe: [{ text: 'Ajuda a equipe a organizar o atendimento.' }],
  casosDeUso: [{ text: 'Quando chegam pedidos fora do horário → monte uma resposta → o cliente recebe orientação.' }],
  passos: [{ tarefa: 'Criar', passos: [{ text: 'Abra **Robôs** e clique em **Criar novo robô**.' }] }],
  duvidas: [], erros: [], suporte: [],
};
const context = { request: { module: 'Robôs', topic: 'Robô' }, screenFacts: facts, business: [] };

test('redação livre mantém seções e passos naturais por tarefa', () => {
  const checked = validateFreeFaqSections(sections, context);
  assert.equal(checked.blocking.length, 0);
  assert.match(renderFreeFaqSections(checked.sections), /## O que é[\s\S]*## Casos de uso[\s\S]*- Quando chegam[\s\S]*### Criar[\s\S]*\*\*Criar novo robô\*\*/u);
  const heading = validateFreeFaqSections({ ...sections, passos: [{ tarefa: '### Criar', passos: sections.passos[0].passos }] }, context);
  assert.doesNotMatch(renderFreeFaqSections(heading.sections), /### ###/u);
  const injected = validateFreeFaqSections({ ...sections, passos: [{ tarefa: '<script>', passos: sections.passos[0].passos }] }, context);
  assert.equal(injected.sections.passos.length, 0);
});

test('travas rígidas recusam rótulo inexistente e destrutivos sem fato com o mesmo verbo', () => {
  for (const text of ['Clique em **Botão imaginário**.', 'Clique em **Excluir tudo**.', 'Apague todos os robôs.', 'Destrua sua conta.']) {
    const result = validateFreeFaqSections({ ...sections, passos: [{ tarefa: 'Criar', passos: [{ text }] }] }, context);
    assert.equal(result.sections.passos?.length ?? 0, 0, text);
    assert.ok(result.blocking.length, text);
  }
  const good = validateFreeFaqSections(sections, context);
  assert.equal(good.sections.passos.length, 1);
  const citedPage = validateFreeFaqSections({ ...sections, passos: [{ tarefa: 'Criar', passos: [
    { text: 'Consulte **Como montar um Menu de opções no robô**.' },
  ] }] }, { ...context, existing: [{ title: 'Como montar um Menu de opções no robô' }] });
  assert.equal(citedPage.sections.passos.length, 1);
});

test('travas de dado pessoal, host externo e código interno', () => {
  for (const text of ['Escreva para maria.real@gmail.com.', 'Abra https://evil.example/roubo.', 'SELECT * FROM users WHERE id = 1;']) {
    const result = validateFreeFaqSections({ ...sections, duvidas: [{ text }] }, context);
    assert.equal(result.sections.duvidas?.length ?? 0, 0, text);
    assert.ok(result.pending.length, text);
  }
});

test('juiz simulado classifica todas as frases e marca a confirmar', async () => {
  let calls = 0;
  const result = await judgeClaims(sections, { ...context, business: [] }, async (claims) => {
    calls++;
    return { claims: claims.map((claim) => ({ id: claim.id,
      status: claim.text.includes('organizar') ? 'a confirmar' : 'sustentada', reason: 'Fonte insuficiente' })) };
  });
  assert.equal(calls, 1);
  assert.ok(result.pending.some((item) => item.includes('organizar')));
  assert.match(renderFreeFaqSections(result.sections), /<AConfirmar>Ajuda a equipe a organizar o atendimento\.<\/AConfirmar>/u);
});

test('contradição aponta revisão e, após uma nova tentativa, vira a confirmar se persistir', async () => {
  const result = await judgeClaims(sections, context, async (claims) => ({ claims: claims.map((claim) => ({
    id: claim.id, status: claim.text.includes('primeira mensagem') ? 'contradiz a fonte' : 'sustentada',
    reason: 'A fonte mostra outro comportamento',
  })) }));
  assert.ok(result.contradictions.some((item) => item.reason.includes('outro comportamento')));
  assert.match(renderFreeFaqSections(result.sections), /<AConfirmar>O robô recebe a primeira mensagem/u);
});

test('saída incompleta do juiz não é aceita como sustentação', async () => {
  await assert.rejects(() => judgeClaims(sections, context, async () => ({ claims: [] })), /juiz|claims|frases/iu);
});

test('componente de prévia existe e está registrado no MDX', async () => {
  const component = await readFile(new URL('../components/site/a-confirmar.tsx', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../components/mdx.tsx', import.meta.url), 'utf8');
  assert.match(component, /function AConfirmar/u);
  assert.match(component, /a-confirmar/u);
  assert.match(registry, /AConfirmar/u);
});

test('pipeline limita chamadas a plano, geração, juiz e uma nova tentativa', async () => {
  const productContext = { groundingRequired: true, pending: [], coverage: [], support: { categories: [], rules: [] },
    businessContext: [], faqStyleExamples: [], screenFacts: [
      { kind: 'route', text: 'Robôs', source: 'src/Fixture.tsx:1', sha },
      { kind: 'action', text: 'Criar novo robô', source: 'src/Fixture.tsx:2', sha },
    ], code: [{ available: true, role: 'frontend', repository: 'ihelpchat/front-react', ref: sha }],
    matches: [{ repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', line: 2,
      sha, ref: sha, excerpt: '2: Criar novo robô' }] };
  const reply = { status: 'ready', summary: 'FAQ do robô.', questions: [], articles: [{
    path: 'docs/teste/robo-novo', title: 'Robô novo', description: 'Ajuda para criar um robô de atendimento.',
    source: 'produto', contentType: 'faq', productActions: [], assistantQuestion: 'Como criar um robô?',
    sections,
  }] };
  const names = [];
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
    { topic: 'Robô', module: 'Robôs', description: 'Criar FAQ para criar um robô.' }, {
      productContext, client: { responses: { create: async (payload) => {
        names.push(payload.text.format.name);
        if (payload.text.format.name === 'plano_documentacao') return { model: 'fixture', output_text: JSON.stringify({
          status: 'ready', guidance: 'Explique como criar um robô.', questions: [], risks: [],
          suggestedActions: [], grounding: [],
        }) };
        if (payload.text.format.name === 'juiz_faq') {
          const claims = JSON.parse(payload.input[1].content).claims;
          return { model: 'fixture', output_text: JSON.stringify({ claims: claims.map(({ id, text }) => ({
            id, status: text.includes('primeira mensagem') ? 'contradiz a fonte' : 'sustentada',
            reason: 'A fonte não confirma',
          })) }) };
        }
        return { model: 'fixture', output_text: JSON.stringify(reply) };
      } } },
    });
  assert.deepEqual(names, ['plano_documentacao', 'pacote_documentacao', 'juiz_faq', 'pacote_documentacao']);
  assert.equal(result.status, 'ready', JSON.stringify(result.questions));
  assert.match(result.articles[0].body, /<AConfirmar>O robô recebe a primeira mensagem/u);
  assert.doesNotMatch(result.articles[0].assistantOverview, /primeira mensagem/u);
  assert.ok(result.pending.some((item) => item.includes('a confirmar')));
});

test('retry editorial reutiliza o juiz sem segunda chamada', async () => {
  const productContext = { groundingRequired: true, pending: [], coverage: [], support: { categories: [], rules: [] },
    businessContext: [], faqStyleExamples: [], screenFacts: [
      { kind: 'route', text: 'Robôs', source: 'src/Fixture.tsx:1', sha },
      { kind: 'action', text: 'Criar novo robô', source: 'src/Fixture.tsx:2', sha },
    ], code: [{ available: true, role: 'frontend', repository: 'ihelpchat/front-react', ref: sha }],
    matches: [{ repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', line: 2,
      sha, ref: sha, excerpt: '2: Criar novo robô' }] };
  const article = { path: 'docs/teste/robo-novo', title: 'Robô novo', description: 'Ajuda para criar um robô de atendimento.',
    source: 'produto', contentType: 'faq', productActions: [], assistantQuestion: 'Como criar um robô?', sections };
  const calls = [];
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
    { topic: 'Robô', module: 'Robôs', description: 'Criar FAQ para criar um robô.' }, {
      productContext, plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
        calls.push(payload.text.format.name);
        if (payload.text.format.name === 'juiz_faq') {
          const claims = JSON.parse(payload.input[1].content).claims;
          return { model: 'fixture', output_text: JSON.stringify({ claims: claims.map(({ id }) =>
            ({ id, status: 'sustentada', reason: '' })) }) };
        }
        return { model: 'fixture', output_text: JSON.stringify({ status: 'ready', summary: 'FAQ.', questions: [],
          articles: [{ ...article, productActions: calls.filter((name) => name === 'pacote_documentacao').length === 1
            ? [{ id: 'inventada', label: 'Inventada', route: '/inventada', target: null }] : [] }] }) };
      } } },
    });
  assert.deepEqual(calls, ['pacote_documentacao', 'pacote_documentacao', 'juiz_faq']);
  assert.equal(result.status, 'ready', JSON.stringify(result.questions));
});
