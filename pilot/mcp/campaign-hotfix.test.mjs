import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
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

const fakeOpenAI = createServer(async (request, response) => {
  assert.equal(request.url, '/v1/responses');
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: 'resp_fixture', object: 'response', created_at: 1, model: 'fixture', status: 'completed',
    output: [{ type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: nested, annotations: [] }] }],
  }));
});
try {
  fakeOpenAI.listen(0, '127.0.0.1');
  await once(fakeOpenAI, 'listening');
  process.env.OPENAI_API_KEY = 'fixture';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${fakeOpenAI.address().port}/v1`;
  process.env.PORT = '0';
  process.env.DOCS_ROOT = root;
  process.env.DOCS_MCP_API_KEY = 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz';
  const { httpServer } = await import('./http.mjs');
  try {
    if (!httpServer.listening) await once(httpServer, 'listening');
    const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/assistant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Como criar e enviar uma campanha?' }),
    });
    assert.equal(response.status, 200, 'POST /assistant responde com sucesso');
    const reply = await response.json();
    assert.equal(reply.sources[0]?.path, guide);
    assert.equal(reply.steps[0]?.action?.id, 'abrir-campanhas');
    assert.doesNotMatch(reply.answer, /^\s*[\{\["`]|\\"answer\\"|"answer"\s*:/);
  } finally {
    await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
} finally {
  await new Promise((resolve, reject) => fakeOpenAI.close((error) => error ? reject(error) : resolve()));
}

console.log('Hotfix Campanhas: parser e seleção do guia.');
