import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAssistantRequest } from '../architecture/conversation-v1.mjs';
import { listConversations, saveConversation, summarizeConversations } from './conversation-log.mjs';

const dir = await mkdtemp(join(tmpdir(), 'claricia-conversations-'));
const file = join(dir, 'conversations.jsonl');
const sessionFile = join(dir, 'sessions.jsonl');
const question = '  Meu telefone é 11987654321 e email é ana@example.com  ';
const fakeOpenAI = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const route = JSON.parse(raw).text?.format?.name === 'triagem_fechada';
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: 'resp_test', object: 'response', created_at: 1, model: 'fixture-model', status: 'completed',
    output: [{ type: 'message', id: 'msg_test', status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: route ? '{"choice":"sem guia"}' : JSON.stringify({
        answer: 'Não encontrei o guia.', sections: [], steps: [{ text: 'Fale com a equipe.' }], code: null,
        sources: [], suggestions: [], resolution: 'not_found', found: false,
      }), annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1 },
  }));
});

try {
  fakeOpenAI.listen(0, '127.0.0.1');
  await once(fakeOpenAI, 'listening');
  process.env.PORT = '0';
  process.env.OPENAI_API_KEY = 'fixture';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${fakeOpenAI.address().port}/v1`;
  process.env.DOCS_MCP_API_KEY = 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz';
  process.env.FEEDBACK_ADMIN_TOKEN = 'fixture-admin-token';
  process.env.CONVERSATIONS_FILE = file;
  process.env.SESSION_EVENTS_FILE = sessionFile;
  process.env.FEEDBACK_FILE = join(dir, 'feedback.jsonl');
  const { httpServer } = await import('./http.mjs');
  try {
    if (!httpServer.listening) await once(httpServer, 'listening');
    const url = `http://127.0.0.1:${httpServer.address().port}`;
    const post = (body) => fetch(`${url}/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const base = { question, sessionId: 'session-12345678', origin: 'app', companyId: 42 };
    const reply = await post(base);
    assert.equal(reply.status, 200);
    const replyBody = await reply.json();
    const conversation = JSON.parse((await readFile(file, 'utf8')).trim());
    assert.equal(conversation.question, question, 'registro novo preserva espaços, telefone e e-mail');
    assert.equal(conversation.companyId, 42);
    assert.equal(conversation.answer, 'Não encontrei o guia.\nFale com a equipe.');
    assert.equal(conversation.resolution, 'not_found');
    assert.match(conversation.sessionId, /^session-[a-f0-9]{16}$/);
    assert.match(conversation.eventId, /^event-[a-f0-9]{16}$/);
    assert.equal(replyBody.eventId, conversation.eventId, 'cliente recebe ID que envia com o feedback');
    const vote = await fetch(`${url}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: conversation.eventId, type: 'assistant', value: 'down', path: '/assistente' }) });
    assert.equal(vote.status, 201);
    assert.equal(JSON.parse((await readFile(process.env.FEEDBACK_FILE, 'utf8')).trim()).id, conversation.eventId,
      'avaliação e conversa usam o mesmo eventId');
    assert.doesNotMatch(await readFile(sessionFile, 'utf8'), /11987654321|ana@example.com/, 'evento M5.03 continua minimizado');

    const faq = await post({ ...base, origin: 'faq' });
    assert.equal(faq.status, 200);
    const faqEntry = JSON.parse((await readFile(file, 'utf8')).trim().split('\n').at(-1));
    assert.equal(faqEntry.companyId, undefined, 'origem faq descarta companyId');
    for (const companyId of [0, -1, 1.5, '42']) {
      const invalid = await post({ ...base, companyId });
      assert.equal(invalid.status, 200, `companyId inválido ${companyId} é descartado`);
      const row = JSON.parse((await readFile(file, 'utf8')).trim().split('\n').at(-1));
      assert.equal(row.companyId, undefined);
    }
    assert.equal(parseAssistantRequest({ ...base }).companyId, 42, 'contrato aceita empresa válida do app');
    assert.equal(parseAssistantRequest({ ...base, origin: 'faq' }).companyId, undefined, 'contrato descarta empresa do FAQ');

    const deniedPage = await fetch(`${url}/admin/claricia`);
    assert.equal(deniedPage.status, 401, 'página exige token');
    assert.match(await deniedPage.text(), /Informe a credencial/, '401 explica como entrar');
    const deniedData = await fetch(`${url}/admin/claricia/data`);
    assert.equal(deniedData.status, 401, 'dados exigem token');
    assert.equal((await deniedData.json()).error, 'unauthorized', '401 explica o motivo');
    const headers = { Authorization: 'Bearer fixture-admin-token', Origin: 'https://faq.example.test' };
    const page = await fetch(`${url}/admin/claricia`, { headers });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('access-control-allow-origin'), null, 'admin não usa CORS');
    const data = await fetch(`${url}/admin/claricia/data`, { headers });
    assert.equal(data.status, 200);
    assert.ok((await data.json()).unresolved.some((row) => row.question === question), 'lista mostra pergunta não resolvida');

    const fixture = Array.from({ length: 10 }, (_, index) => ({
      at: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`, origin: index < 5 ? 'app' : 'faq',
      ...(index < 5 ? { companyId: 42 } : {}), question: `Fixture ${index}`, answer: 'Resposta',
      resolution: ['complete', 'complete', 'complete', 'complete', 'partial', 'not_found', 'escalated', 'abandoned', 'in_progress', 'complete'][index],
    }));
    const fixtureFile = join(dir, 'fixture.jsonl');
    for (const row of fixture) await saveConversation(fixtureFile, row);
    const selected = summarizeConversations(await listConversations(fixtureFile), { from: '2026-09-03', to: '2026-09-08', origin: 'app', companyId: 42, resolution: 'partial' });
    assert.equal(selected.total, 1, 'filtros sobre fixture JSONL com 10 conversas');

    await rm(file);
    await mkdir(file);
    const stillReplies = await post({ ...base, question: 'mcp' });
    assert.equal(stillReplies.status, 200, 'falha de escrita não derruba a resposta');
  } finally {
    await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  }
} finally {
  await new Promise((resolve) => fakeOpenAI.close(resolve));
  await rm(dir, { recursive: true, force: true });
}

const rows = Array.from({ length: 10 }, (_, i) => ({
  at: `2026-09-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`, question: `Pergunta ${i}`,
  answer: `Resposta ${i}`, origin: i < 5 ? 'app' : 'faq', companyId: i < 5 ? 42 : undefined,
  topic: i < 5 ? 'abrir-canais' : 'abrir-usuarios', action: 'abrir',
  resolution: ['complete', 'complete', 'complete', 'complete', 'partial', 'not_found', 'escalated', 'abandoned', 'in_progress', 'complete'][i],
}));
const summary = summarizeConversations(rows, { page: 1, pageSize: 10 });
assert.equal(summary.total, 10);
assert.equal(summary.percentages.complete, 50);
assert.equal(summary.percentages.partial, 10);
assert.equal(summary.percentages.not_found, 10);
assert.equal(summary.percentages.escalated, 10);
assert.equal(summary.percentages.abandoned, 10);
assert.equal(summary.byTopic.find((row) => row.topic === 'abrir-canais / abrir').resolvedPercent, 80);
assert.equal(summary.byCompany[0].companyId, 42);
assert.equal(summary.unresolved[0].question, 'Pergunta 6', 'não resolvidas mais recentes primeiro');
const filtered = summarizeConversations(rows, { from: '2026-09-03', to: '2026-09-08', origin: 'app', companyId: 42, resolution: 'partial' });
assert.equal(filtered.total, 1, 'filtros combinados');
assert.equal(filtered.unresolved[0].question, 'Pergunta 4');
const directDir = await mkdtemp(join(tmpdir(), 'claricia-conversations-direct-'));
try {
  const directFile = join(directDir, 'conversations.jsonl');
  await saveConversation(directFile, rows[0]);
  assert.equal((await listConversations(directFile)).length, 1);
} finally { await rm(directDir, { recursive: true, force: true }); }
console.log('M5.51 conversation log: OK');
