import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { widgetConfigFromEnv, widgetConfigFor, companyFromQuery, pilotGuideIds, widgetConfigEnv } from './widget-config.mjs';

const silent = () => {};
const off = { schemaVersion: 1, widget: { enabled: false, pilotGuides: [] } };
const on = { schemaVersion: 1, widget: { enabled: true, pilotGuides: [] } };

// Padrão fechado: só `true`/`1` liga; ausência, vazio e valor inválido mantêm o widget oculto.
for (const value of [undefined, '', '  ', 'false', '0', 'ture', 'yes', 'on', 'TRUE '.repeat(2)]) {
  const env = value === undefined ? {} : { ASSISTANT_WIDGET_ENABLED: value };
  assert.deepEqual(widgetConfigFor(widgetConfigFromEnv(env, silent), 42), off, `"${value}" não liga o widget`);
}
for (const value of ['true', 'TRUE', ' true ', '1']) {
  assert.deepEqual(widgetConfigFor(widgetConfigFromEnv({ ASSISTANT_WIDGET_ENABLED: value }, silent), 42), on);
  assert.deepEqual(widgetConfigFor(widgetConfigFromEnv({ ASSISTANT_WIDGET_ENABLED: value }, silent)), on, 'sem lista de empresas, vale para todas');
}
const warnings = [];
widgetConfigFromEnv({ ASSISTANT_WIDGET_ENABLED: 'sk-proj-FAKESECRET012345678901234567890' }, (line) => warnings.push(line));
assert.equal(warnings.length, 1, 'valor inválido avisa uma vez');
assert.doesNotMatch(warnings.join('\n'), /FAKESECRET/, 'aviso não repete o valor configurado');

// Lista de empresas só restringe; variável presente nunca vira "todas".
const allowlist = widgetConfigFromEnv({ ASSISTANT_WIDGET_ENABLED: 'true', ASSISTANT_WIDGET_COMPANY_IDS: ' 1, 7 ,abc,-3,0,1' }, silent);
assert.deepEqual([...allowlist.companyIds], [1, 7]);
assert.deepEqual(widgetConfigFor(allowlist, 1), on);
assert.deepEqual(widgetConfigFor(allowlist, 7), on);
assert.deepEqual(widgetConfigFor(allowlist, 2), off);
assert.deepEqual(widgetConfigFor(allowlist), off, 'empresa desconhecida não entra na lista');
for (const hostile of ['1', 1.5, -1, 0, Number.NaN, null, {}, [1]]) {
  assert.deepEqual(widgetConfigFor(allowlist, hostile), off, 'empresa precisa ser um inteiro positivo');
}
const invalidOnly = widgetConfigFromEnv({ ASSISTANT_WIDGET_ENABLED: 'true', ASSISTANT_WIDGET_COMPANY_IDS: 'todas' }, silent);
assert.deepEqual(widgetConfigFor(invalidOnly, 1), off, 'lista só com valores inválidos não libera ninguém');
assert.deepEqual(widgetConfigFor(widgetConfigFromEnv({ ASSISTANT_WIDGET_COMPANY_IDS: '1' }, silent), 1), off, 'lista sem a chave geral não liga');

// Roteiros de piloto: só IDs dos drafts, só para empresas listadas, nunca para todos.
assert.deepEqual(pilotGuideIds, ['reconectar-canal-qr'], 'roteiros publicados saem do piloto');
const pilotEnv = { ASSISTANT_WIDGET_ENABLED: 'true', ASSISTANT_WIDGET_PILOT_GUIDES: 'reconectar-canal-qr, desconhecido,reconectar-canal-qr,usuario-acesso,../segredo', ASSISTANT_WIDGET_PILOT_COMPANY_IDS: '1' };
const pilot = widgetConfigFromEnv(pilotEnv, silent);
assert.deepEqual(pilot.pilotGuides, ['reconectar-canal-qr'], 'publicado não volta ao piloto');
assert.deepEqual(widgetConfigFor(pilot, 1), { schemaVersion: 1, widget: { enabled: true, pilotGuides: ['reconectar-canal-qr'] } });
assert.deepEqual(widgetConfigFor(pilot, 2), on, 'outra empresa vê o widget sem os roteiros de piloto');
assert.deepEqual(widgetConfigFor(pilot), on);
const pilotWithoutAudience = [];
const noAudience = widgetConfigFromEnv({ ASSISTANT_WIDGET_ENABLED: 'true', ASSISTANT_WIDGET_PILOT_GUIDES: 'reconectar-canal-qr' }, (line) => pilotWithoutAudience.push(line));
assert.deepEqual(widgetConfigFor(noAudience, 1), on, 'piloto sem lista de empresas não é oferecido');
assert.ok(pilotWithoutAudience.some((line) => line.includes(widgetConfigEnv.pilotCompanyIds)));
const pilotDisabled = widgetConfigFromEnv({ ...pilotEnv, ASSISTANT_WIDGET_ENABLED: 'false' }, silent);
assert.deepEqual(widgetConfigFor(pilotDisabled, 1), off, 'widget desligado não devolve roteiros');
const pilotOutsideWidget = widgetConfigFromEnv({ ...pilotEnv, ASSISTANT_WIDGET_COMPANY_IDS: '2' }, silent);
assert.deepEqual(widgetConfigFor(pilotOutsideWidget, 1), off, 'piloto não reabre o widget para empresa fora da lista geral');
const serialized = JSON.stringify(widgetConfigFor(allowlist, 1));
assert.doesNotMatch(serialized, /7|companyIds/u, 'resposta não revela as outras empresas');

const query = (value) => companyFromQuery(new URLSearchParams(value));
assert.deepEqual(query(''), { ok: true });
assert.deepEqual(query('company=42'), { ok: true, companyId: 42 });
for (const invalid of ['company=', 'company=0', 'company=-1', 'company=1.5', 'company=abc', 'company=1&company=2', 'company=9999999999999999', 'company=42%20OR%201']) {
  assert.deepEqual(query(invalid), { ok: false }, invalid);
}

// HTTP: três serviços com configurações diferentes; nenhum pedido de configuração chama o provider.
let providerCalls = 0;
const reply = { answer: 'Abra Campanhas para preparar o envio.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true };
const fakeOpenAI = createServer(async (request, response) => {
  let input = '';
  for await (const chunk of request) input += chunk;
  providerCalls++;
  const route = JSON.parse(input).text?.format?.name === 'triagem_fechada';
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: 'resp_fixture', object: 'response', created_at: 1, model: 'fixture', status: 'completed',
    output: [{ type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: route ? '{"choice":"sem guia"}' : JSON.stringify(reply), annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
});
const dir = await mkdtemp(join(tmpdir(), 'widget-config-'));
const servers = [];
const appOrigin = 'https://app.exemplo.test';
async function start(name, env) {
  for (const key of Object.values(widgetConfigEnv)) delete process.env[key];
  Object.assign(process.env, env);
  const { httpServer } = await import(`./http.mjs?widget-config-${name}`);
  if (!httpServer.listening) await once(httpServer, 'listening');
  servers.push(httpServer);
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  return {
    config: (search = '', headers = {}) => fetch(`${base}/assistant/config${search}`, { headers }),
    ask: (body) => fetch(`${base}/assistant`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    base,
  };
}
try {
  fakeOpenAI.listen(0, '127.0.0.1');
  await once(fakeOpenAI, 'listening');
  Object.assign(process.env, {
    PORT: '0', OPENAI_API_KEY: 'fixture', OPENAI_BASE_URL: `http://127.0.0.1:${fakeOpenAI.address().port}/v1`,
    DOCS_ROOT: new URL('../', import.meta.url).pathname, MCP_STATE_DIR: dir,
    SESSION_EVENTS_FILE: join(dir, 'events.jsonl'), CONVERSATIONS_FILE: join(dir, 'conversations.jsonl'),
    FEEDBACK_FILE: join(dir, 'feedback.jsonl'), ASSISTANT_BUDGET_FILE: join(dir, 'budget.json'),
    DOCS_MCP_API_KEY: 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz', ASSISTANT_ALLOWED_ORIGINS: appOrigin,
  });

  // 1. Sem variável: oculto para todos; perguntas do app param antes do provider; o FAQ continua respondendo.
  const closed = await start('default', {});
  const closedResponse = await closed.config('?company=42', { Origin: appOrigin });
  assert.equal(closedResponse.status, 200);
  assert.equal(closedResponse.headers.get('cache-control'), 'no-store');
  assert.match(closedResponse.headers.get('content-type'), /^application\/json/u);
  assert.equal(closedResponse.headers.get('access-control-allow-origin'), appOrigin, 'origem do app lê a configuração');
  assert.deepEqual(await closedResponse.json(), off);
  assert.equal((await closed.config('', { Origin: 'https://outra.exemplo.test' })).headers.get('access-control-allow-origin'), null, 'origem não listada não recebe CORS');
  assert.equal((await closed.config('?company=abc')).status, 400);
  assert.equal((await fetch(`${closed.base}/assistant/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, 'configuração é somente leitura');
  const refused = await closed.ask({ question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session-1', origin: 'app', companyId: 42 });
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { error: 'Assistente indisponível.', code: 'widget_disabled' });
  assert.equal(providerCalls, 0, 'configuração e pergunta recusada não chamam o provider');
  const faq = await closed.ask({ question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session-2', origin: 'faq' });
  assert.equal(faq.status, 200, 'o FAQ não depende da chave do widget do app');
  const afterFaq = providerCalls;
  assert.ok(afterFaq > 0);

  // 2. Ligado para todos.
  const open = await start('enabled', { ASSISTANT_WIDGET_ENABLED: 'true' });
  assert.deepEqual(await (await open.config()).json(), on);
  assert.deepEqual(await (await open.config('?company=42')).json(), on);
  assert.equal(providerCalls, afterFaq, 'ler a configuração não chama o provider');
  assert.equal((await open.ask({ question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session-3', origin: 'app', companyId: 42 })).status, 200);

  // 3. Lista de empresas e piloto: cada empresa só recebe a própria decisão.
  const staged = await start('staged', {
    ASSISTANT_WIDGET_ENABLED: 'true', ASSISTANT_WIDGET_COMPANY_IDS: '1,7',
    ASSISTANT_WIDGET_PILOT_GUIDES: 'reconectar-canal-qr', ASSISTANT_WIDGET_PILOT_COMPANY_IDS: '1',
  });
  assert.deepEqual(await (await staged.config('?company=1')).json(), { schemaVersion: 1, widget: { enabled: true, pilotGuides: ['reconectar-canal-qr'] } });
  assert.deepEqual(await (await staged.config('?company=7')).json(), on);
  assert.deepEqual(await (await staged.config('?company=2')).json(), off);
  assert.deepEqual(await (await staged.config()).json(), off);
  const calls = providerCalls;
  assert.equal((await staged.ask({ question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session-4', origin: 'app', companyId: 2 })).status, 403);
  assert.equal((await staged.ask({ question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session-5', origin: 'app' })).status, 403, 'app sem empresa confirmada não passa pela lista');
  assert.equal(providerCalls, calls);
  assert.equal((await staged.ask({ question: 'Como criar e enviar uma campanha?', sessionId: 'fixture-session-6', origin: 'app', companyId: 7 })).status, 200);
  console.log('widget-config: padrão fechado, lista de empresas, piloto restrito e leitura sem provider');
} finally {
  for (const server of servers) server.close();
  fakeOpenAI.close();
  await rm(dir, { recursive: true, force: true });
}
