import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSessionEvent } from './session-events.mjs';

const eventFile = join(await mkdtemp(join(tmpdir(), 'claricia-events-http-')), 'events.jsonl');
const root = new URL('../', import.meta.url).pathname;
const guide = '/docs/principais-motivos-de-suporte/campanhas';
const payload = {
  answer: 'Abra Campanhas para preparar o envio.', sections: [], steps: [], code: null,
  sources: [guide], suggestions: [], resolution: 'complete', found: true,
};
const fakeOpenAI = createServer(async (request, response) => {
  assert.equal(request.url, '/v1/responses');
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: 'resp_fixture', object: 'response', created_at: 1, model: 'fixture', status: 'completed',
    output: [{ type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify(payload), annotations: [] }] }],
  }));
});

try {
  fakeOpenAI.listen(0, '127.0.0.1');
  await once(fakeOpenAI, 'listening');
  process.env.OPENAI_API_KEY = 'fixture';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${fakeOpenAI.address().port}/v1`;
  process.env.PORT = '0';
  process.env.DOCS_ROOT = root;
  process.env.SESSION_EVENTS_FILE = eventFile;
  const { httpServer } = await import('./http.mjs');
  try {
    if (!httpServer.listening) await once(httpServer, 'listening');
    const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/assistant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session',
        guideId: 'guia-forjado', stepId: 'passo-forjado',
      }),
    });
    assert.equal(response.status, 200);
    const reply = await response.json();
    assert.equal(reply.resolution, 'complete', 'resposta HTTP prova o resultado resolvido');
    assert.ok(reply.steps.length > 0, 'pergunta guiada mostra passo documentado');
    const [event] = (await readFile(eventFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(event.result, reply.resolution, 'evento guarda o mesmo resultado da resposta');
    assert.equal(event.guideId, 'campanhas', 'guia vem da fonte resolvida pelo servidor');
    assert.equal(event.stepId, 'passo-1', 'passo vem da etapa resolvida pelo servidor');
    assert.equal(event.sessionId, 'fixture-session');
  } finally {
    await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
} finally {
  await new Promise((resolve, reject) => fakeOpenAI.close((error) => error ? reject(error) : resolve()));
}

const base = { sessionId: 'fixture-session', origin: 'faq', result: 'complete', path: '/assistente' };
assert.equal(normalizeSessionEvent({ ...base, durationMs: 300_000 }).durationMs, 300_000);
assert.throws(() => normalizeSessionEvent({ ...base, durationMs: 300_001 }), /Evento inválido/);
console.log('Session events HTTP: guia, passo, resultado e duração.');
