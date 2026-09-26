import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildServer } from './server.mjs';
import { answerQuestion } from './assistant-service.mjs';
import { saveFeedback, summarizeFeedback } from './feedback-service.mjs';
import { sanitizeWidgetContext } from './real-state.mjs';

const apiKey = process.env.DOCS_MCP_API_KEY;
if (apiKey && apiKey.length < 24) throw new Error('DOCS_MCP_API_KEY precisa ter ao menos 24 caracteres');

const mcpHandler = createMcpHandler(() => buildServer());
const handler = toNodeHandler(mcpHandler);
const port = Number(process.env.PORT ?? 3100);
const root = process.env.DOCS_ROOT ?? new URL('../', import.meta.url).pathname;
const feedbackFile = process.env.FEEDBACK_FILE ?? '/tmp/ihelp-docs-feedback.jsonl';
const feedbackAdminToken = process.env.FEEDBACK_ADMIN_TOKEN;
const allowedOrigins = new Set((process.env.ASSISTANT_ALLOWED_ORIGINS ?? 'http://127.0.0.1:4173,http://localhost:4173').split(',').map((value) => value.trim()).filter(Boolean));
const assistantSessions = new Map();
const assistantIps = new Map();
const feedbackIps = new Map();
const windowMs = 60_000;
const assistantSessionLimit = 10;
const assistantIpLimit = Math.max(10, Math.min(100, Number(process.env.ASSISTANT_IP_LIMIT) || 100));
const feedbackIpLimit = 30;
const trustedIpSource = process.env.TRUSTED_IP_SOURCE ?? (process.env.RAILWAY_ENVIRONMENT_NAME === 'production' ? 'x-real-ip' : 'xff-hops');
const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
const trustProxyHops = Number.isInteger(configuredProxyHops) && configuredProxyHops >= 0 && configuredProxyHops <= 10 ? configuredProxyHops : 0;
let lastSweep = Date.now();

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Expose-Headers', 'Retry-After');
  }
}

function clientIp(request) {
  if (trustedIpSource === 'x-real-ip') {
    const candidate = request.headers['x-real-ip'];
    if (typeof candidate === 'string' && isIP(candidate.trim())) return candidate.trim();
  }
  const forwarded = trustedIpSource === 'xff-hops' ? request.headers['x-forwarded-for'] : undefined;
  if (trustProxyHops > 0 && typeof forwarded === 'string') {
    const hops = forwarded.split(',').map((value) => value.trim());
    const candidate = hops.at(-trustProxyHops);
    if (candidate && isIP(candidate)) return candidate;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function quota(map, key, limit, now) {
  if (now - lastSweep >= windowMs) {
    for (const bucket of [assistantSessions, assistantIps, feedbackIps]) {
      for (const [entry, times] of bucket) {
        const recent = times.filter((time) => now - time < windowMs);
        if (recent.length) bucket.set(entry, recent);
        else bucket.delete(entry);
      }
    }
    lastSweep = now;
  }
  const recent = (map.get(key) ?? []).filter((time) => now - time < windowMs);
  if (!recent.length) map.delete(key);
  else map.set(key, recent);
  return { map, key, recent, retryAfter: recent.length >= limit ? Math.ceil((windowMs - (now - recent[0])) / 1000) : 0 };
}

function rateLimit(response, limits) {
  const retryAfter = Math.max(...limits.map((item) => item.retryAfter));
  if (retryAfter) {
    response.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) })
      .end(JSON.stringify({ error: 'Só um instante, já te respondo. Tente novamente em breve.' }));
    return true;
  }
  const now = Date.now();
  for (const item of limits) {
    item.recent.push(now);
    item.map.set(item.key, item.recent);
  }
  return false;
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_000) throw new Error('payload muito grande');
  }
  return JSON.parse(raw || '{}');
}

export const httpServer = createServer(async (request, response) => {
  cors(request, response);
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (pathname === '/assistant' && request.method === 'POST') {
    try {
      const body = await readJson(request);
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (question.length < 1 || question.length > 500) throw new Error('A pergunta deve ter entre 1 e 500 caracteres.');
      const ip = clientIp(request);
      const sessionId = typeof body.sessionId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(body.sessionId)
        ? body.sessionId : 'anonymous';
      const now = Date.now();
      if (rateLimit(response, [
        quota(assistantSessions, `${ip}:${sessionId}`, assistantSessionLimit, now),
        quota(assistantIps, ip, assistantIpLimit, now),
      ])) return;
      const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
      const scope = typeof body.scope === 'string' ? body.scope : 'Tudo';
      const page = body.page && typeof body.page.path === 'string' && body.page.path.startsWith('/') && body.page.path.length < 300
        ? { path: body.page.path, title: typeof body.page.title === 'string' ? body.page.title.slice(0, 200) : '' }
        : undefined;
      const result = await answerQuestion(root, question, { history, scope, page, widgetContext: sanitizeWidgetContext(body.widgetContext) });
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
  if (pathname === '/feedback' && request.method === 'POST') {
    try {
      const body = await readJson(request);
      const ip = clientIp(request);
      if (rateLimit(response, [quota(feedbackIps, ip, feedbackIpLimit, Date.now())])) return;
      const event = await saveFeedback(feedbackFile, body, { userAgent: request.headers['user-agent'] });
      response.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ saved: true, id: event.id }));
    } catch (error) {
      const invalid = /Feedback|payload|JSON/i.test(error.message);
      response.writeHead(invalid ? 400 : 500, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: invalid ? error.message : 'Não foi possível salvar a avaliação.' }));
    }
    return;
  }
  if (pathname === '/feedback/summary' && request.method === 'GET') {
    if (!feedbackAdminToken || request.headers.authorization !== `Bearer ${feedbackAdminToken}`) {
      response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const summary = await summarizeFeedback(feedbackFile);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(summary));
    return;
  }
  if (pathname !== '/mcp') {
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
