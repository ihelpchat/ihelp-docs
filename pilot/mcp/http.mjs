import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildServer } from './server.mjs';
import { answerQuestion } from './assistant-service.mjs';
import { normalizeFeedback, saveFeedback, summarizeFeedback } from './feedback-service.mjs';
import { sanitizeWidgetContext } from './real-state.mjs';
import { saveSessionEvent, pruneSessionEvents } from './session-events.mjs';
import { topicForQuestion } from './closed-router.mjs';
import { actionForQuestion, issueForQuestion } from './gap-classification.mjs';
import { parseAssistantRequest } from '../architecture/conversation-v1.mjs';
import { publishedPathOrNull } from './published-paths.mjs';
import { opaqueId } from './opaque-id.mjs';
import { authenticate, requestIdentity } from './access-control.mjs';
import { assistantRouterModel, mcpCredentialsFromEnv } from './env-compat.mjs';

const credentials = mcpCredentialsFromEnv();
if (!credentials.length) throw new Error('Configure DOCS_MCP_CREDENTIALS ou DOCS_MCP_API_KEY antes de iniciar o MCP');
assistantRouterModel();

const mcpHandler = createMcpHandler(() => buildServer());
const handler = toNodeHandler(mcpHandler);
const port = Number(process.env.PORT ?? 3100);
const root = process.env.DOCS_ROOT ?? new URL('../', import.meta.url).pathname;
const feedbackFile = process.env.FEEDBACK_FILE ?? '/tmp/ihelp-docs-feedback.jsonl';
const sessionEventsFile = process.env.SESSION_EVENTS_FILE ?? '/tmp/ihelp-docs-session-events.jsonl';
const feedbackAdminToken = process.env.FEEDBACK_ADMIN_TOKEN;
const allowedOrigins = new Set((process.env.ASSISTANT_ALLOWED_ORIGINS ?? 'http://127.0.0.1:4173,http://localhost:4173').split(',').map((value) => value.trim()).filter(Boolean));
let lastSessionPrune = 0;
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
  if (pathname === '/health' && request.method === 'GET') {
    try {
      const manifest = JSON.parse(await readFile(join(root, 'public/guides/manifest.json'), 'utf8'));
      const catalog = JSON.parse(await readFile(join(root, 'public/guides', manifest.current, 'catalog.json'), 'utf8'));
      const release = JSON.parse(await readFile(join(root, 'public/release.json'), 'utf8'));
      const codeSha = release.codeSha;
      if (!/^[a-f0-9]{40}$/u.test(codeSha ?? '') || manifest.current !== catalog.contentSha256?.slice(0, 12)) throw new Error('versão indisponível');
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ codeSha, contentSha256: catalog.contentSha256 }));
    } catch {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: 'versão indisponível' }));
    }
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (pathname === '/assistant' && request.method === 'POST') {
    try {
      const startedAt = Date.now();
      const body = parseAssistantRequest(await readJson(request));
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
      const pagePath = publishedPathOrNull(body.page?.path);
      const page = pagePath
        ? { path: pagePath, title: body.page.title }
        : undefined;
      const widgetContext = sanitizeWidgetContext(body.widgetContext);
      let resolvedStep;
      const result = await answerQuestion(root, question, {
        history, scope, page, guide: body.guide, widgetContext,
        onResolvedStep: (step) => { resolvedStep = step; },
      });
      const topic = topicForQuestion(question);
      const issue = issueForQuestion(question, widgetContext);
      const action = issue === 'usage' ? actionForQuestion(question) : undefined;
      try {
        const now = Date.now();
        if (now - lastSessionPrune > 24 * 60 * 60_000) {
          await pruneSessionEvents(sessionEventsFile, { now });
          lastSessionPrune = now;
        }
        await saveSessionEvent(sessionEventsFile, {
          sessionId: opaqueId('session', body.sessionId ?? crypto.randomUUID()),
          origin: body.origin === 'app' ? 'app' : 'faq',
          ...resolvedStep,
          durationMs: Math.min(now - startedAt, 300_000),
          result: ['complete', 'partial', 'not_found', 'in_progress'].includes(result.resolution) ? result.resolution : 'not_found',
          ...(topic ? { topic } : {}),
          ...(action ? { action } : {}),
          issue,
          path: pagePath ?? '/assistente',
        }, { now });
      } catch {
        console.error('Falha ao registrar evento de sessão');
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    } catch (error) {
      const unavailable = /OPENAI_API_KEY/.test(error.message);
      const invalid = error.name === 'ZodError' || /pergunta|payload|JSON/i.test(error.message);
      const status = unavailable ? 503 : invalid ? 400 : 502;
      const message = unavailable || !invalid ? 'Assistente temporariamente indisponível.' : error.name === 'ZodError' ? 'Pedido inválido.' : error.message;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: message }));
    }
    return;
  }
  if (pathname === '/feedback' && request.method === 'POST') {
    try {
      const body = await readJson(request);
      const localPath = (path) => typeof path === 'string' && /^\/(?!\/)[a-z0-9/_-]*$/iu.test(path);
      if (!localPath(body.path) || (body.sources !== undefined
        && (!Array.isArray(body.sources) || body.sources.some((path) => !localPath(path))))) {
        throw new Error('Feedback inválido.');
      }
      const normalized = {
        ...body,
        ...(body.eventId === undefined ? {} : { eventId: opaqueId('event', body.eventId) }),
        path: publishedPathOrNull(body.path),
        ...(body.sources === undefined ? {} : { sources: body.sources.map(publishedPathOrNull).filter(Boolean) }),
      };
      normalizeFeedback(normalized);
      const ip = clientIp(request);
      if (rateLimit(response, [quota(feedbackIps, ip, feedbackIpLimit, Date.now())])) return;
      const event = await saveFeedback(feedbackFile, normalized, { userAgent: request.headers['user-agent'] });
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
  const identity = authenticate(credentials, request.headers.authorization);
  if (!identity) {
    response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  await requestIdentity.run(identity, () => handler(request, response));
});

httpServer.listen(port, '0.0.0.0', () => console.error(`iHelp Docs MCP ouvindo na porta ${port}`));

process.on('SIGINT', async () => {
  await mcpHandler.close();
  httpServer.close(() => process.exit(0));
});
