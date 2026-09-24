import assert from 'node:assert/strict';
import { answerQuestion, parseAnswer, retrieveContext } from './assistant-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const guide = '/docs/principais-motivos-de-suporte/campanhas';
const legacy = '/docs/sobre-o-sistema/campanhas';
const payload = {
  answer: 'Abra Campanhas para preparar o envio.', sections: [],
  steps: [{ text: 'Abra Campanhas.', actionId: null, imagePath: null }],
  code: null, sources: [legacy], suggestions: [], resolution: 'complete', found: true,
};
const nested = JSON.stringify(JSON.stringify(payload));
const client = { responses: { create: async () => ({ model: 'fixture', output_text: nested }) } };

for (const output of [
  nested,
  JSON.stringify({ ...payload, answer: JSON.stringify(payload) }),
  `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
  `Resposta estruturada:\n${JSON.stringify(payload)}\nFim.`,
]) {
  const parsed = parseAnswer(output);
  assert.equal(parsed.answer, payload.answer, 'extrai o objeto estruturado');
  assert.deepEqual(parsed.sources, [legacy]);
  assert.equal(parsed.steps[0]?.text, payload.steps[0].text);
  assert.doesNotMatch(parsed.answer, /^\s*[\{\["`]|\\"answer\\"|"answer"\s*:/);
}
for (const output of [
  `\`\`json\n{"answer":\n\`\`\``,
  JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify(payload))))),
]) {
  const parsed = parseAnswer(output);
  assert.doesNotMatch(parsed.answer, /^\s*[\{\["`]|\\"answer\\"|"answer"\s*:/, 'fallback não mostra JSON literal');
  assert.ok(parsed.answer.length > 0 && parsed.answer.length < 300);
}

for (const question of [
  'Como criar e enviar uma campanha?',
  'Como disparar campanha?',
  'Como fazer campanha de WhatsApp?',
]) {
  const context = await retrieveContext(root, question);
  assert.equal(context[0]?.path, guide, `guia priorizado: ${question}`);
  const reply = await answerQuestion(root, question, { client });
  assert.equal(reply.sources[0]?.path, guide, `fonte correta: ${question}`);
  assert.equal(reply.steps[0]?.action?.id, 'abrir-campanhas', `ProductAction: ${question}`);
  assert.ok(reply.steps.length >= 1 && reply.steps.length <= 3, `visão progressiva: ${question}`);
  assert.doesNotMatch(reply.answer, /^\s*[\{\["`]|\\"answer\\"|"answer"\s*:/);
  const all = await answerQuestion(root, `Quero todos os passos: ${question}`, { client });
  assert.equal(all.steps.length, 7, `modo completo: ${question}`);
}

for (const [question, expected] of [
  ['Como criar template para campanha?', '/docs/whatsapp-business-api/funcionamento/o-que-sao-templates-e-para-que-servem'],
  ['Como usar API para campanha?', '/docs/sobre-o-sistema/campanhas/campanhas-na-api-oficial'],
  ['Como enviar arquivos na campanha?', '/docs/principais-motivos-de-suporte/arquivos'],
]) {
  const relevantClient = { responses: { create: async () => ({ output_text: JSON.stringify({ ...payload, sources: [expected] }) }) } };
  const reply = await answerQuestion(root, question, { client: relevantClient });
  assert.notEqual(reply.sources[0]?.path, guide, `não força campanha: ${question}`);
  assert.notEqual(reply.steps[0]?.action?.id, 'abrir-campanhas', `ação correta: ${question}`);
}

console.log('Hotfix Campanhas: parser e seleção do guia.');
