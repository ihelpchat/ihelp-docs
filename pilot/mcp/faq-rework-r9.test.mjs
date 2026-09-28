import test from 'node:test';
import assert from 'node:assert/strict';
import * as faq from './faq-editorial.mjs';
import { FAQ_NEUTRAL_WORDS } from './faq-neutral-words.mjs';

const sha = 'a'.repeat(40);
const fact = { kind: 'action', text: 'Adicionar Contato', repository: 'ihelpchat/front-react',
  path: 'src/Contact.tsx', lineStart: 12, lineEnd: 12, sha };
const citation = { repository: fact.repository, path: fact.path, lineStart: 12, lineEnd: 12, sha };
const context = { screenFacts: [fact], request: { topic: 'Contatos', description: 'Cadastrar contatos.' } };
const { validateFaqSections } = faq;
const unit = (text, citations) => ({ text, citations });
const check = (key, text, cite = citation) => validateFaqSections({ [key]: [{ text, citations: [cite] }] }, context);

test('passo usa o rótulo do fato e recusa prosa livre', () => {
  assert.equal(validateFaqSections({ passos: [{ acao: 'clicar', fato: 'f1' }] }, context).sections.passos?.[0].text,
    'Clique em **Adicionar Contato**.');
  assert.equal(check('passos', 'Na tela, clique em Adicionar Contato.').sections.passos, undefined);
  assert.equal(check('passos', 'Clique em **Excluir tudo**.').sections.passos, undefined);
  assert.equal(check('passos', 'Clique em **Adicionar Contato** e suas vendas dobram em 30 dias.').sections.passos, undefined);
  assert.equal(check('passos', 'Clique em **Adicionar Contato** e suas vendas dobram.').sections.passos, undefined);
  assert.equal(check('passos', 'Clique em **Adicionar Contato** e aguarde 30 dias.').sections.passos, undefined);
});

test('seções de negócio mantêm cobertura integral e vocabulário neutro restrito', () => {
  const quote = 'Organizar contatos ajuda a equipe.';
  const ctx = { request: { description: quote } };
  const cite = { source: 'pedido', quote };
  const result = (text) => validateFaqSections({ quandoUsar: [{ text, citations: [cite] }] }, ctx).sections.quandoUsar;
  assert.equal(result('Organizar contatos na tela ajuda a equipe.' )?.length, 1);
  assert.equal(result('Organizar contatos bloqueia clientes inadimplentes.'), undefined);
  assert.equal(result('Organizar contatos ajuda a equipe e atende clientes inadimplentes.'), undefined);
  for (const word of ['tela', 'campo', 'botão', 'menu', 'lista', 'linha', 'perfil', 'página', 'opção', 'aba', 'janela', 'registro', 'item', 'ícone', 'caixa', 'lo', 'las'])
    assert.ok(FAQ_NEUTRAL_WORDS.includes(word), word);
});

test('resposta direta é construída dos fatos e tarefas sem prosa do modelo', () => {
  assert.equal(typeof faq.deterministicFaqAnswer, 'function');
  const answer = faq.deterministicFaqAnswer({ topic: 'Contatos', description: 'Quero cadastrar contatos e exportar dados.' },
    [{ kind: 'route', text: 'Contatos' }, fact]);
  assert.match(answer.text, /Na tela \*\*Contatos\*\*/u);
  assert.match(answer.text, /cadastrar/u);
  assert.doesNotMatch(answer.text, /exportar/u);
  assert.deepEqual(answer.citations, [citation]);
  const route = { ...fact, kind: 'route', text: 'Contatos', lineStart: 11, lineEnd: 11 };
  const withRoute = faq.deterministicFaqAnswer({ topic: 'Contatos', description: 'Cadastrar contatos.' },
    [route, fact]);
  assert.deepEqual(withRoute.citations, [{ ...citation, lineStart: 11, lineEnd: 11 }, citation]);
  const robotFact = { ...fact, text: 'Criar novo robô' };
  const robot = faq.deterministicFaqAnswer({ topic: 'Robôs', description: 'Criar um robô.' },
    [{ kind: 'route', text: 'Bot' }, robotFact]);
  assert.match(robot.text, /você pode criar\./u);
});

test('rótulo exato é destacado pelo renderizador', () => {
  const rendered = validateFaqSections({ passos: [{ acao: 'clicar', fato: 'f1' }] }, context);
  assert.equal(rendered.sections.passos?.[0].text, 'Clique em **Adicionar Contato**.');
});

test('unidade de passo do Robô não aceita segunda frase livre', () => {
  const robot = { ...fact, text: 'Criar novo robô' };
  const result = validateFaqSections({ passos: [unit('Para criar, clique em **Criar novo robô**. Esse comando inicia a criação de um robô.', [citation])] },
    { screenFacts: [robot], request: { topic: 'Robô de atendimento', description: 'Criar um robô.' } });
  assert.equal(result.sections.passos, undefined);
  const structured = validateFaqSections({ passos: [{ acao: 'clicar', fato: 'f1' }] },
    { screenFacts: [robot] });
  assert.equal(structured.sections.passos?.[0].text, 'Clique em **Criar novo robô**.');
});
