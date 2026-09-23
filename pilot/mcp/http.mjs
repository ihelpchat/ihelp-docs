import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildServer } from './server.mjs';
import { answerQuestion } from './assistant-service.mjs';

const apiKey = process.env.DOCS_MCP_API_KEY;
if (apiKey && apiKey.length < 24) throw new Error('DOCS_MCP_API_KEY precisa ter ao menos 24 caracteres');

const mcpHandler = createMcpHandler(() => buildServer());
const handler = toNodeHandler(mcpHandler);
const port = Number(process.env.PORT ?? 3100);
const root = process.env.DOCS_ROOT ?? new URL('../', import.meta.url).pathname;
const allowedOrigins = new Set((process.env.ASSISTANT_ALLOWED_ORIGINS ?? 'http://127.0.0.1:4173,http://localhost:4173').split(',').map((value) => value.trim()).filter(Boolean));
const requests = new Map();

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
}

function limited(request) {
  const ip = String(request.headers['x-forwarded-for'] ?? request.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (requests.get(ip) ?? []).filter((time) => now - time < 60_000);
  recent.push(now);
  requests.set(ip, recent);
  return recent.length > 10;
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_000) throw new Error('payload muito grande');
  }
  return JSON.parse(raw || '{}');
}

const httpServer = createServer(async (request, response) => {
  cors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.url === '/assistant' && request.method === 'POST') {
    if (limited(request)) {
      response.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Muitas perguntas. Tente novamente em um minuto.' }));
      return;
    }
    try {
      const body = await readJson(request);
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (question.length < 4 || question.length > 500) throw new Error('A pergunta deve ter entre 4 e 500 caracteres.');
      const result = await answerQuestion(root, question);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    } catch (error) {
      const unavailable = /OPENAI_API_KEY/.test(error.message);
      const invalid = /pergunta|payload|JSON/i.test(error.message);
      const status = unavailable ? 503 : invalid ? 400 : 502;
      const message = unavailable || !invalid ? 'Assistente temporariamente indisponível.' : error.message;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: message }));
    }
    return;
  }
  if (request.url !== '/mcp') {
    response.writeHead(404).end();
    return;
  }
  if (!apiKey) {
    response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'MCP não configurado' }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${apiKey}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  await handler(request, response);
});

httpServer.listen(port, '0.0.0.0', () => console.error(`iHelp Docs MCP ouvindo na porta ${port}`));

process.on('SIGINT', async () => {
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
});
