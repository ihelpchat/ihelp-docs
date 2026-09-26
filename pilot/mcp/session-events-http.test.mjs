import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSessionEvent } from './session-events.mjs';

const eventFile = join(await mkdtemp(join(tmpdir(), 'claricia-events-http-')), 'events.jsonl');
const feedbackFile = join(await mkdtemp(join(tmpdir(), 'claricia-feedback-http-')), 'feedback.jsonl');
const root = new URL('../', import.meta.url).pathname;
const guide = '/docs/principais-motivos-de-suporte/campanhas';
const sentinel = 'sk-proj-FAKESECRET012345678901234567890';
const hostilePath = `/docs/${sentinel}`;
const providerInputs = [];
const payload = {
  answer: 'Abra Campanhas para preparar o envio.', sections: [], steps: [], code: null,
  sources: [guide], suggestions: [], resolution: 'complete', found: true,
};
const fakeOpenAI = createServer(async (request, response) => {
  assert.equal(request.url, '/v1/responses');
  let input = '';
  for await (const chunk of request) input += chunk;
  providerInputs.push(input);
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
  process.env.FEEDBACK_FILE = feedbackFile;
  const { httpServer } = await import('./http.mjs');
  try {
    if (!httpServer.listening) await once(httpServer, 'listening');
    const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/assistant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session',
        page: { path: hostilePath, title: 'Campanhas' },
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
    assert.match(event.sessionId, /^session-[a-f0-9]{16}$/);
    assert.notEqual(event.sessionId, 'fixture-session', 'ID do cliente não é gravado cru');
    assert.equal(event.path, null, 'caminho não publicado não entra no evento');
    assert.ok(providerInputs.length > 0, 'a pergunta deve chamar o provider');
    assert.doesNotMatch(providerInputs.join('\n'), /FAKESECRET012345678901234567890/, 'page.path não chega ao provider');
    assert.doesNotMatch(await readFile(eventFile, 'utf8'), /FAKESECRET012345678901234567890/, 'page.path não chega ao JSONL');

    const published = await fetch(`http://127.0.0.1:${httpServer.address().port}/assistant`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Como criar e enviar uma campanha?', page: { path: guide, title: 'Campanhas' } }),
    });
    assert.equal(published.status, 200);
    assert.match(providerInputs.at(-1), /A pessoa está vendo a página/);
    assert.ok(providerInputs.at(-1).includes(guide), 'caminho publicado chega ao prompt');
    const publishedEvent = JSON.parse((await readFile(eventFile, 'utf8')).trim().split('\n').at(-1));
    assert.equal(publishedEvent.path, guide, 'caminho publicado chega ao evento');

    const feedback = await fetch(`http://127.0.0.1:${httpServer.address().port}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'article', value: 'up', path: hostilePath, sources: [guide, hostilePath] }),
    });
    assert.equal(feedback.status, 201);
    const recordedFeedback = await readFile(feedbackFile, 'utf8');
    assert.doesNotMatch(recordedFeedback, /FAKESECRET012345678901234567890/);
    assert.deepEqual(JSON.parse(recordedFeedback).sources, [guide]);
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
