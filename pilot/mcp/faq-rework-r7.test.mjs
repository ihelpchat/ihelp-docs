import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFaqSections } from './faq-editorial.mjs';
import { FAQ_NEUTRAL_WORDS } from './faq-neutral-words.mjs';

const sentence = 'Use opções para distribuir mensagens, mas não inclua dois casos.';
const request = { topic: 'Robô', description: 'O Robô distribui atendimentos.',
  details: 'Use opções para distribuir mensagens.' };
const citation = { source: 'pedido', quote: request.details };
const check = (text, cited = citation) => validateFaqSections({ quandoUsar: [{ text, citations: [cited] }] },
  { request });

test('stopwords portuguesas não incluem termos de negócio e cobrem palavras funcionais', () => {
  assert.ok(FAQ_NEUTRAL_WORDS.length >= 190);
  for (const word of ['mas', 'não', 'pois', 'dois', 'inclui', 'casos'])
    assert.ok(FAQ_NEUTRAL_WORDS.includes(word.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')), word);
  for (const word of ['vendas', 'clientes', 'inadimplentes', 'bloqueia'])
    assert.ok(!FAQ_NEUTRAL_WORDS.includes(word), word);
});

test('radical leve casa dez flexões úteis, sem apagar substantivo de negócio', () => {
  for (const [a, b] of [
    ['distribuir', 'distribui'], ['distribuindo', 'distribui'], ['contatos', 'contato'],
    ['clientes', 'cliente'], ['organizada', 'organizado'], ['enviar', 'enviou'],
    ['enviei', 'enviam'], ['respondendo', 'responder'], ['receberá', 'recebe'],
    ['configurado', 'configurando'],
  ]) {
    const result = validateFaqSections({ quandoUsar: [{ text: `${a}.`,
      citations: [{ source: 'pedido', quote: `Use ${b} no Robô.` }] }] },
    { request: { description: `Use ${b} no Robô.` } });
    assert.equal(result.sections.quandoUsar?.length, 1, `${a}/${b}: ${result.pending.join('; ')}`);
  }
});

test('pedido cobre details, flexão e stopwords; uma promessa nova continua recusada', () => {
  assert.equal(check(sentence).sections.quandoUsar?.length, 1);
  const negative = check(`${sentence} Isso bloqueia clientes inadimplentes.`);
  assert.equal(negative.sections.quandoUsar, undefined);
  const sales = check(`${sentence} As vendas dobram em 30 dias.`);
  assert.equal(sales.sections.quandoUsar, undefined);
});

test('metanarração é omitida com motivo próprio, mesmo quando todas as palavras são citadas', () => {
  for (const phrase of ['O pedido define o Robô.', 'O sinal agregado mostra dúvidas.',
    'A fonte indica opções.', 'Isso não está descrito aqui.', 'Esses casos não estão descritos.']) {
    const result = validateFaqSections({ quandoUsar: [{ text: phrase,
      citations: [{ source: 'pedido', quote: `${phrase} ${request.details}` }] }] },
    { request: { description: `${phrase} ${request.details}` } });
    assert.equal(result.sections.quandoUsar, undefined, phrase);
    assert.ok(result.pending.some((item) => item.includes('metanarração')), phrase);
  }
});

test('demonstrativos, possessivos e indefinidos são palavras funcionais', () => {
  for (const word of ['esse', 'essa', 'este', 'esta', 'isso', 'isto', 'aquele', 'aquela',
    'meu', 'minha', 'seu', 'sua', 'algum', 'alguma', 'qualquer', 'outro', 'outra'])
    assert.ok(FAQ_NEUTRAL_WORDS.includes(word), word);
});

test('derivações mínimas dos verbos neutros preservam cobertura de negócio', () => {
  for (const [noun, verb] of [['escolhas', 'escolher'], ['criação', 'criar'], ['edição', 'editar']]) {
    const quote = `Você pode ${verb} na tela do Robô.`;
    const result = validateFaqSections({ quandoUsar: [{ text: `Use ${noun} na tela do Robô.`,
      citations: [{ source: 'pedido', quote }] }] }, { request: { description: quote } });
    assert.equal(result.sections.quandoUsar?.length, 1, `${noun}: ${result.pending.join('; ')}`);
  }
});

test('replay Robô: apresentação de escolhas não exige verbo genérico na fonte', () => {
  const quote = 'como “Vendas” ou “Suporte”';
  const text = 'Você pode criar um menu com opções como “Vendas” e “Suporte” para apresentar escolhas no fluxo.';
  const result = validateFaqSections({ quandoUsar: [{ text,
    citations: [{ source: 'pagina', path: '/docs/robo', quote }] }] },
  { request: { topic: 'Robô', description: 'Criar um menu no fluxo.' },
    existing: [{ path: '/docs/robo', body: quote }] });
  assert.equal(result.sections.quandoUsar?.length, 1, result.pending.join('; '));
});
