import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyFaqQuestions, validateFaqSections } from './faq-editorial.mjs';
import { planContent } from './content-ai-service.mjs';

// Trechos literais dos replays offline: Agenda resp-1, Robô resp-2 e resp-3.
const replay = JSON.parse(readFileSync(new URL('./fixtures/m559-r5-replay.json', import.meta.url), 'utf8'));
const agendaQuestion = replay.agendaPlan.questions.find((question) => question.startsWith('Para exportar:'));
const agendaRequest = { topic: 'Agenda de Contatos', module: 'Contatos',
  description: 'Criar FAQ para buscar, cadastrar e exportar contatos.' };
const agendaFacts = [{ kind: 'action', text: 'Adicionar Contato', source: 'src/Contact.tsx:12' },
  { kind: 'field', text: 'Buscar contato...', source: 'src/Contact.tsx:13' }];
const context = (screenFacts) => ({ groundingRequired: true,
  code: [{ available: true, repository: 'ihelpchat/front-react', ref: 'a'.repeat(40), role: 'frontend' }],
  matches: [{ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', line: 12,
    ref: 'a'.repeat(40), sha: 'a'.repeat(40), excerpt: '12: Adicionar Contato' }],
  screenFacts, support: { categories: [], rules: [] }, coverage: [], pending: [],
  businessContext: [], faqStyleExamples: [] });
const replayPlan = { model: 'replay', output_text: JSON.stringify(replay.agendaPlan) };

test('Agenda replay: exportação sem fato vira pendência e outras tarefas seguem', async () => {
  const plan = await planContent(new URL('../', import.meta.url).pathname, agendaRequest,
    { productContext: context(agendaFacts), client: { responses: { create: async () => replayPlan } } });
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.questions, []);
  assert.ok(plan.pending.includes(`pergunta pendente: ${agendaQuestion}`));
});

test('Agenda negativo: sem fato para nenhuma tarefa continua needs_information', async () => {
  const plan = await planContent(new URL('../', import.meta.url).pathname, agendaRequest,
    { productContext: context([]), client: { responses: { create: async () => replayPlan } } });
  assert.equal(plan.status, 'needs_information');
});

const robotRequest = { topic: 'Robô de atendimento',
  description: 'Criar FAQ do Robô de atendimento: chatbot que responde e distribui os atendimentos.' };
const cited = (text, quote) => ({ text, citations: [{ source: 'pagina', path: '/docs/menu-de-opcoes', quote }] });
const robotContext = { request: robotRequest, existing: [{ path: '/docs/menu-de-opcoes',
  body: 'Crie escolhas no Menu de opções, como “Vendas” e “Suporte”. com a escolha que o cliente verá, como “Vendas” ou “Suporte”.' }],
  screenFacts: [{ kind: 'text', text: 'Menu de opções', repository: 'ihelpchat/front-react',
    path: 'src/Robot.tsx', lineStart: 9, lineEnd: 9, sha: 'a'.repeat(40) }] };

test('Robô replay: tema e verbos de interação não exigem citação própria', () => {
  const purpose = validateFaqSections({ paraQueServe: [replay.robotRetry.purpose] }, robotContext);
  assert.equal(purpose.sections.paraQueServe?.length, 1);

  const use = validateFaqSections({ quandoUsar: [replay.robotRetry.whenUse] }, {
    ...robotContext, existing: [{ path: replay.robotRetry.whenUse.citations[0].path,
      body: replay.robotRetry.whenUse.citations[0].quote }],
  });
  assert.equal(use.sections.quandoUsar?.length, 1);
  const initial = validateFaqSections({ quandoUsar: [replay.robotInitial.whenUse] }, {
    ...robotContext, existing: [{ path: replay.robotInitial.whenUse.citations[0].path,
      body: replay.robotInitial.whenUse.citations[0].quote }],
  });
  assert.equal(initial.sections.quandoUsar, undefined);
  assert.ok(initial.pending.some((item) => item.includes('palavra sem fonte: cliente, ligar, fluxo')));
  assert.ok(!initial.pending.some((item) => item.includes('palavra sem fonte: apresentar')));
  assert.equal(replay.robotInitial.status, 'ready');
  assert.equal(replay.robotRetry.status, 'ready');
});

test('Robô negativo: substantivos sem fonte continuam omitidos', () => {
  const positive = cited('Use um Menu de opções quando quiser oferecer escolhas como “Vendas” e “Suporte”.',
    'Crie escolhas no Menu de opções, como “Vendas” e “Suporte”.');
  const negative = { ...positive, text: `${positive.text} Isso bloqueia clientes inadimplentes.` };
  const result = validateFaqSections({ quandoUsar: [negative] }, robotContext);
  assert.equal(result.sections.quandoUsar, undefined);
  assert.ok(result.pending.some((item) => item.includes('clientes') && item.includes('inadimplentes')));
  const oneNoun = validateFaqSections({ quandoUsar: [{ ...positive,
    text: `${positive.text} clientes.` }] }, robotContext);
  assert.equal(oneNoun.sections.quandoUsar, undefined);
  assert.ok(oneNoun.pending.some((item) => item.includes('clientes')));
});

test('rótulo literal entre aspas é coberto pelo fato da tela', () => {
  const fact = { kind: 'action', text: 'Menu de opções', repository: 'ihelpchat/front-react',
    path: 'src/Robot.tsx', lineStart: 9, lineEnd: 9, sha: 'a'.repeat(40) };
  const { kind: _kind, text: _text, ...citation } = fact;
  const result = validateFaqSections({ resposta: [{ text: 'Abra “Menu de opções”.',
    citations: [citation] }] }, { request: robotRequest, screenFacts: [fact] });
  assert.equal(result.sections.resposta?.length, 1);
});

test('pergunta principal só bloqueia sem outra tarefa com fato de tela', () => {
  assert.deepEqual(classifyFaqQuestions([agendaQuestion], agendaRequest, agendaFacts).blocking, []);
  assert.deepEqual(classifyFaqQuestions([agendaQuestion], agendaRequest, []).blocking, [agendaQuestion]);
});
