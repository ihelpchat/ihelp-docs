import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const scratch = await mkdtemp(join(tmpdir(), 'claricia-limits-'));
const fakeOpenAI = createServer((_request, response) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
  id: 'resp_fixture', object: 'response', created_at: 1, model: 'fixture', status: 'completed',
  output: [{ type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text: JSON.stringify({ answer: 'Pode continuar.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true }), annotations: [] }] }],
})));
fakeOpenAI.listen(0, '127.0.0.1');
await once(fakeOpenAI, 'listening');
process.env.PORT = '0';
process.env.OPENAI_API_KEY = 'fixture-only';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${fakeOpenAI.address().port}/v1`;
process.env.FEEDBACK_FILE = join(scratch, 'feedback.jsonl');
process.env.ASSISTANT_IP_LIMIT = '20';
const { httpServer } = await import('./http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
const url = `http://127.0.0.1:${httpServer.address().port}`;
const post = (path, body, sessionId = 'session-a') => fetch(`${url}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.40' },
  body: JSON.stringify({ ...body, sessionId: `test-${sessionId}` }),
});

try {
  for (const question of ['sim', 'não', 'ok']) {
    assert.equal((await post('/assistant', { question }, `short-${question}`)).status, 200, `${question} chega ao HTTP`);
  }
  assert.equal((await post('/assistant', { question: '  ' }, 'empty')).status, 400, 'vazio rejeitado');

  for (let n = 0; n < 11; n += 1) {
    assert.equal((await post('/assistant', { question: 'mcp' }, `peer-${n}`)).status, 200, 'sessões no mesmo IP não compartilham teto de conversa');
  }

  for (let n = 0; n < 10; n += 1) {
    assert.equal((await post('/feedback', { eventId: `vote-${n}`, type: 'article', value: 'up', path: '/docs/teste' }, `vote-session-${n}`)).status, 201);
  }
  assert.equal((await post('/assistant', { question: 'mcp' }, 'after-feedback')).status, 200, 'feedback não consome cota de conversa');

  for (let n = 0; n < 5; n += 1) {
    assert.equal((await post('/assistant', { question: 'mcp' }, `rotated-${n}`)).status, 200);
  }
  const limited = await post('/assistant', { question: 'mcp' }, 'rotated-again');
  assert.equal(limited.status, 429, 'trocar sessão não remove proteção do IP');
  assert.match(limited.headers.get('retry-after') ?? '', /^[1-9]\d*$/, '429 informa espera em segundos');
  assert.match((await limited.json()).error, /instante|aguard|tente/i);
} finally {
  await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => fakeOpenAI.close((error) => error ? reject(error) : resolve()));
  await rm(scratch, { recursive: true, force: true });
}

const source = await readFile(new URL('../lib/assistant.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function exerciseClient(responses) {
  const calls = [];
  const context = {
    exports: {},
    process: { env: { NEXT_PUBLIC_ASSISTANT_URL: 'https://fixture.test/assistant' } },
    require: () => ({}),
    fetch: async (_endpoint, options) => {
      calls.push(options);
      return responses.shift();
    },
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout: () => {},
  };
  vm.runInNewContext(compiled, context, { filename: 'assistant.ts' });
  const request = { question: 'sim', history: [], scope: 'Tudo', sessionId: 'client-session' };
  return { calls, result: context.exports.requestAnswer(request).then((value) => ({ value }), (error) => ({ error })) };
}
const response = (status, body, retryAfter) => ({
  ok: status === 200, status,
  headers: { get: () => retryAfter },
  json: async () => body,
});
const sample = { answer: 'Pode continuar.', sources: [] };
{
  const client = await exerciseClient([response(429, { error: 'Muitas perguntas.' }, '1'), response(200, sample)]);
  const { value, error } = await client.result;
  assert.equal(error, undefined);
  assert.equal(value.answer, sample.answer);
  assert.equal(client.calls.length, 2, '429 recuperável tenta só mais uma vez');
}
{
  const client = await exerciseClient([response(429, { error: 'Muitas perguntas.' }, '1'), response(429, { error: 'Muitas perguntas.' }, '1')]);
  const { error } = await client.result;
  assert.equal(client.calls.length, 2, 'segundo 429 encerra o retry');
  assert.match(error.message, /instante|aguard|tente/i, 'erro final é acolhedor');
}

console.log('Transporte HTTP, limites e retry: OK');
