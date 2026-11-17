import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerQuestion, personVoiceSuggestions } from './assistant-service.mjs';
import { freeAnswerClient } from './fixtures/free-answer-client.mjs';
const client = freeAnswerClient({ responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
  answer: 'Orientação inicial.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true,
}) }) } });
const root = new URL('../', import.meta.url).pathname;
const history = [
  { role: 'user', content: 'Como reconectar canal pelo QR?' },
  { role: 'assistant', content: 'Quer que eu te guie?\nFonte usada: /docs/principais-motivos-de-suporte/reconectar-canal-qr' },
];
const reply = await answerQuestion(root, 'Sim, pode me ajudar a criar uma campanha?', { client, history });
assert.equal(reply.sources[0]?.path, '/docs/principais-motivos-de-suporte/campanhas', 'pedido explícito de outro assunto não continua o guia anterior');
console.log('guide-continuation-regression: ok');

await test('desejo em primeira pessoa permanece disponível', () => {
  assert.deepEqual(personVoiceSuggestions(['Gostaria de aprender a criar campanhas']), ['Gostaria de aprender a criar campanhas']);
  assert.deepEqual(personVoiceSuggestions(['Gostaria que eu te ajudasse?']), []);
});
await test('oferta com substantivo guia permanece disponível', () => {
  assert.deepEqual(personVoiceSuggestions(['Quer um guia para criar campanhas?'], 'Quer ajuda?'), ['Sim, me guie passo a passo']);
});
await test('pedido explícito de procedimento completo é preservado', async () => {
  const reply = await answerQuestion(root, 'Me guie com todos os passos de uma vez para criar uma campanha', { client });
  assert.equal(reply.steps.length, 7);
});
