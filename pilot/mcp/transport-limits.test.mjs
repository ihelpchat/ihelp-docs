import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseAssistantRequest } from '../architecture/conversation-v1.mjs';

const require = createRequire(import.meta.url);
assert.equal(parseAssistantRequest({ question: 'sim', sessionId: 'session-valid-123' }).sessionId, 'session-valid-123',
  'contrato v1 preserva o ID usado pelo limite da conversa');

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
process.env.ASSISTANT_ALLOWED_ORIGINS = 'https://faq.example.test';
process.env.DOCS_MCP_API_KEY = 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz';
const { httpServer } = await import('./http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
const url = `http://127.0.0.1:${httpServer.address().port}`;
const post = (path, body, sessionId = 'session-a', forwardedFor = '192.0.2.40') => fetch(`${url}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwardedFor },
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
  assert.ok(Number(limited.headers.get('retry-after')) >= 50, '429 informa o tempo restante da janela, não 1 segundo fixo');
  assert.match((await limited.json()).error, /instante|aguard|tente/i);

  const crossOrigin = await fetch(`${url}/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://faq.example.test', 'X-Forwarded-For': '192.0.2.40' },
    body: JSON.stringify({ question: 'mcp', sessionId: 'test-cross-origin' }),
  });
  assert.equal(crossOrigin.status, 429);
  assert.equal(crossOrigin.headers.get('access-control-allow-origin'), 'https://faq.example.test');
  assert.match(crossOrigin.headers.get('access-control-expose-headers') ?? '', /(?:^|,\s*)Retry-After(?:\s*,|$)/i,
    'resposta HTTP entre origens expõe Retry-After ao navegador');
  assert.ok(Number(crossOrigin.headers.get('retry-after')) >= 50);

  for (let n = 0; n < 10; n += 1) {
    assert.equal((await post('/assistant', { question: 'mcp' }, 'same-session', '198.51.100.88')).status, 200);
  }
  assert.equal((await post('/assistant', { question: 'mcp' }, 'same-session', '198.51.100.88')).status, 429,
    '11ª pergunta da mesma sessão é limitada antes do teto agregado de 20');

  for (let n = 0; n < 10; n += 1) {
    assert.equal((await post('/assistant', { question: 'mcp' }, 'spoofed-session', `203.0.113.${n}, 198.51.100.99`)).status, 200);
  }
  assert.equal((await post('/assistant', { question: 'mcp' }, 'spoofed-session', '203.0.113.250, 198.51.100.99')).status, 429,
    'XFF forjado à esquerda não troca o balde da sessão');

  for (let n = 0; n < 30; n += 1) {
    assert.equal((await post('/feedback', { eventId: `separate-vote-${n}`, type: 'article', value: 'up', path: '/docs/teste' },
      `feedback-${n}`, '192.0.2.240')).status, 201);
  }
  assert.equal((await post('/feedback', { eventId: 'separate-vote-30', type: 'article', value: 'up', path: '/docs/teste' },
    'feedback-30', '192.0.2.240')).status, 429, '31ª avaliação do mesmo IP recebe 429');
  for (let n = 0; n < 30; n += 1) {
    assert.equal((await post('/feedback', { eventId: `invalid-vote-${n}`, type: 'invalid', value: 'up', path: '/docs/teste' },
      `invalid-feedback-${n}`, '192.0.2.241')).status, 400);
  }
  assert.equal((await post('/feedback', { eventId: 'valid-after-rejections', type: 'article', value: 'up', path: '/docs/teste' },
    'valid-after-rejections', '192.0.2.241')).status, 201, 'feedback rejeitado não consome cota');
} finally {
  await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => fakeOpenAI.close((error) => error ? reject(error) : resolve()));
  await rm(scratch, { recursive: true, force: true });
}

process.env.TRUST_PROXY_HOPS = '2';
const { httpServer: twoHopServer } = await import('./http.mjs?two-hops');
if (!twoHopServer.listening) await once(twoHopServer, 'listening');
const twoHopUrl = `http://127.0.0.1:${twoHopServer.address().port}/assistant`;
try {
  for (let n = 0; n < 10; n += 1) {
    const reply = await fetch(twoHopUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${n}, 198.51.100.90, 192.0.2.41` },
      body: JSON.stringify({ question: 'mcp', sessionId: 'two-hop-session' }),
    });
    assert.equal(reply.status, 200);
  }
  const limited = await fetch(twoHopUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.250, 198.51.100.90, 192.0.2.99' },
    body: JSON.stringify({ question: 'mcp', sessionId: 'two-hop-session' }),
  });
  assert.equal(limited.status, 429, 'TRUST_PROXY_HOPS=2 escolhe o segundo valor à direita');
  for (let n = 0; n < 10; n += 1) {
    const reply = await fetch(twoHopUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'mcp', sessionId: 'socket-session' }),
    });
    assert.equal(reply.status, 200);
  }
  const socketLimited = await fetch(twoHopUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'mcp', sessionId: 'socket-session' }),
  });
  assert.equal(socketLimited.status, 429, 'sem XFF usa endereço do socket');
} finally {
  await new Promise((resolve, reject) => twoHopServer.close((error) => error ? reject(error) : resolve()));
}

async function verifyIpSource(source, moduleName) {
  if (source) process.env.TRUSTED_IP_SOURCE = source;
  else delete process.env.TRUSTED_IP_SOURCE;
  const { httpServer: server } = await import(`./http.mjs?${moduleName}`);
  if (!server.listening) await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${server.address().port}/assistant`;
  try {
    const realIpMode = source === 'x-real-ip' || moduleName === 'railway-default';
    const count = realIpMode ? 20 : 10;
    for (let n = 0; n < count; n += 1) {
      const reply = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Real-IP': '198.51.100.72', 'X-Forwarded-For': `203.0.113.${n}, 192.0.2.${n}` },
        body: JSON.stringify({ question: 'mcp', sessionId: `${moduleName}-session-${Math.floor(n / 10)}` }),
      });
      assert.equal(reply.status, 200);
    }
    if (realIpMode) {
      const otherNetwork = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Real-IP': '198.51.100.73', 'X-Forwarded-For': '203.0.113.240, 192.0.2.240' },
        body: JSON.stringify({ question: 'mcp', sessionId: `${moduleName}-other-network` }),
      });
      assert.equal(otherNetwork.status, 200, `${moduleName} separa redes com o mesmo socket`);
    }
    const limited = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': '198.51.100.72', 'X-Forwarded-For': '203.0.113.240, 192.0.2.240' },
      body: JSON.stringify({ question: 'mcp', sessionId: `${moduleName}-session-0` }),
    });
    assert.equal(limited.status, 429, `${moduleName} usa a fonte de IP configurada`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
await verifyIpSource('x-real-ip', 'real-ip');
await verifyIpSource('socket', 'socket-ip');
process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
await verifyIpSource(undefined, 'railway-default');
delete process.env.RAILWAY_ENVIRONMENT_NAME;
delete process.env.TRUSTED_IP_SOURCE;

delete process.env.ASSISTANT_IP_LIMIT;
delete process.env.TRUST_PROXY_HOPS;
const { httpServer: defaultLimitServer } = await import('./http.mjs?default-ip-limit');
if (!defaultLimitServer.listening) await once(defaultLimitServer, 'listening');
const defaultLimitUrl = `http://127.0.0.1:${defaultLimitServer.address().port}/assistant`;
try {
  for (let n = 1; n <= 100; n += 1) {
    const reply = await fetch(defaultLimitUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'mcp', sessionId: `default-limit-session-${n}` }),
    });
    assert.equal(reply.status, 200, `${n}ª sessão no mesmo IP é aceita pelo teto padrão`);
  }
  const limited = await fetch(defaultLimitUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'mcp', sessionId: 'default-limit-session-101' }),
  });
  assert.equal(limited.status, 429, '101ª sessão no mesmo IP excede o teto padrão');
  assert.match(limited.headers.get('retry-after') ?? '', /^[1-9]\d*$/, 'teto padrão informa Retry-After');
} finally {
  await new Promise((resolve, reject) => defaultLimitServer.close((error) => error ? reject(error) : resolve()));
}

const source = await readFile(new URL('../lib/assistant.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function exerciseClient(responses) {
  const calls = [];
  const scheduled = [];
  const context = {
    exports: {},
    process: { env: { NEXT_PUBLIC_ASSISTANT_URL: 'https://fixture.test/assistant' } },
    require: () => ({}),
    fetch: async (_endpoint, options) => {
      calls.push(options);
      return responses.shift();
    },
    setTimeout: (callback, delay) => { scheduled.push(delay); callback(); return 1; },
    clearTimeout: () => {},
  };
  vm.runInNewContext(compiled, context, { filename: 'assistant.ts' });
  const request = { question: 'sim', history: [], scope: 'Tudo', sessionId: 'client-session' };
  return { calls, scheduled, result: context.exports.requestAnswer(request).then((value) => ({ value }), (error) => ({ error })) };
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
{
  const client = await exerciseClient([response(429, { error: 'Muitas perguntas.' }, '7'), response(200, sample)]);
  await client.result;
  assert.deepEqual(client.scheduled, [7_000], 'o retry respeita o tempo do Retry-After');
}

const jsx = await readFile(new URL('../components/assistant/assistant-thread.tsx', import.meta.url), 'utf8');
const rendered = ts.transpileModule(jsx, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const react = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ui = { exports: {}, require: (name) => {
  if (name === 'react/jsx-runtime' || name === 'react') return require(name);
  if (name === '@/components/assistant/assistant-context') return { useAssistant: () => ({
    messages: [{ id: 'error-1', role: 'error', question: 'sim', message: 'Só um instante.', status: 429 }],
    busy: false, retry: () => {},
  }) };
  if (name === '@/lib/links') return {
    supportUrl: 'https://wa.me/551730422307', productActionUrl: () => null,
    supportLink: () => 'https://wa.me/551730422307', supportGuideFromPage: () => undefined, supportGuideFromReply: () => undefined,
  };
  if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
  return {};
} };
vm.runInNewContext(rendered, ui, { filename: 'assistant-thread.tsx' });
for (const compact of [false, true]) {
  const html = renderToStaticMarkup(react.createElement(ui.exports.AssistantThread, { compact }));
  assert.match(html, /Tentar de novo/);
  assert.match(html, /href="https:\/\/wa\.me\/551730422307"[^>]*>Falar com uma pessoa<\/a>/,
    '429 final mostra saída humana no painel e na tela cheia');
}

const css = await readFile(new URL('../app/global.css', import.meta.url), 'utf8');
function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}
for (const selector of ['.ih-ai-busy-label', '.ih-ai-thread[data-compact] .ih-ai-busy-label']) {
  assert.match(cssRule(selector), /font-size:\s*(?:1[6-9]|[2-9]\d)px/, `${selector} tem fonte de pelo menos 16 px`);
}
for (const selector of ['.ih-ai-error-actions button', '.ih-ai-error-actions a', '.ih-ai-thread[data-compact] .ih-ai-error-actions button', '.ih-ai-thread[data-compact] .ih-ai-error-actions a']) {
  assert.match(cssRule(selector), /min-height:\s*(?:4[4-9]|[5-9]\d)px/, `${selector} tem área de toque de pelo menos 44 px`);
}

console.log('Transporte HTTP, limites e retry: OK');
