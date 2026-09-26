import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion } from './assistant-service.mjs';

const root = await mkdtemp(join(tmpdir(), 'guide-boundary-'));
const dir = join(root, 'content/docs');
const state = (stepId = 'inicio', extra = {}) => ({ guideId: 'reconectar-canal-qr', stepId, version: 1, mode: 'real', ...extra });
let calls = 0;
const provider = createServer(async (_request, response) => {
  calls += 1;
  response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
});
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'reconectar.mdx'), `---
title: Reconectar canal
guide:
  schemaVersion: 1
  guideId: reconectar-canal-qr
  version: 1
  mode: real
  initialStepId: inicio
  steps:
    - stepId: inicio
      text: Abra canais.
    - stepId: final
      text: Confira o canal.
---
Teste.
`);
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
process.env.PORT = '0';
process.env.DOCS_ROOT = root;
process.env.OPENAI_API_KEY = 'fixture';
process.env.DOCS_MCP_API_KEY = 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
process.env.SESSION_EVENTS_FILE = join(root, 'sessions.jsonl');
const { httpServer } = await import('./http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
let requestIndex = 0;
const post = async (question, guide) => {
  const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/assistant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${++requestIndex}` },
    body: JSON.stringify({ question, guide, sessionId: `test-session-${requestIndex}` }),
  });
  assert.equal(response.status, 200);
  return response.json();
};
const safe = (reply) => {
  assert.equal(reply.resolution, 'not_found');
  assert.deepEqual(reply.suggestions, ['Recomeçar', 'Falar com uma pessoa']);
  if (reply.guide) {
    assert.equal(reply.guide.guideId, 'reconectar-canal-qr');
    assert.equal(reply.guide.stateToken, undefined, 'estado seguro não autoriza avançar');
  }
};
try {
  const first = await post('Começar', state());
  assert.equal(first.guide.stepId, 'inicio');
  assert.ok(first.guide.stateToken, 'passo precisa de token assinado');
  assert.equal(calls, 0, 'guia HTTP nunca chama provider');
  const next = await post('Concluí este passo', { ...first.guide });
  assert.equal(next.guide.stepId, 'final');
  assert.equal(calls, 0);
  safe(await post('Concluir guia', first.guide));
  safe(await post('Concluir guia', state('final')));
  safe(await post('Avançar', { ...state(), guideId: 'campanhas' }));
  safe(await post('Avançar', state('inexistente')));
  safe(await post('Avançar', state('inicio', { version: 2 })));
  safe(await post('Avançar', state('inicio', { stateToken: 'invalid' })));
  safe(await post('Avançar', state('final', { stateToken: first.guide.stateToken })));
  assert.equal(calls, 0, 'estado inválido não pode alcançar provider');
  const done = await post('Concluir guia', next.guide);
  assert.equal(done.answer, 'Você concluiu o guia.');
  assert.equal(done.resolution, 'complete');
  const human = await post('Falar com uma pessoa', state('inexistente'));
  assert.equal(human.resolution, 'partial', 'pedido de pessoa tem prioridade sobre estado inválido');
  assert.equal(calls, 0);
  const direct = await answerQuestion(root, 'Avançar', { guide: state('inexistente'), apiKey: '' });
  safe(direct);
} finally {
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  await rm(root, { recursive: true, force: true });
}
