import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assistantRequestSchema } from '../architecture/conversation-v1.mjs';
import { feedbackInputSchema } from './feedback-service.mjs';
import { sessionEventSchema } from './session-events.mjs';

const secret = 'sk-proj-fakesecret012345678901234567890';
const phone = '11987654321';
const dir = await mkdtemp(join(tmpdir(), 'claricia-schema-boundary-'));
const providerInputs = [];
const fakeOpenAI = createServer(async (request, response) => {
  let input = '';
  for await (const chunk of request) input += chunk;
  providerInputs.push(input);
  response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: 'resp_fixture', object: 'response', created_at: 1, model: 'fixture', status: 'completed',
    output: [{ type: 'message', id: 'msg_fixture', status: 'completed', role: 'assistant',
      content: [{ type: 'output_text', text: JSON.stringify({
        answer: 'Abra Campanhas.', sections: [], steps: [], code: null, sources: [],
        suggestions: [], resolution: 'complete', found: true,
      }), annotations: [] }] }],
  }));
});

function unwrap(schema) {
  while (['optional', 'nullable', 'default', 'transform', 'pipe'].includes(schema._zod.def.type)) {
    schema = schema._zod.def.innerType ?? schema._zod.def.in;
  }
  return schema;
}

function textPaths(schema, path = []) {
  schema = unwrap(schema);
  if (schema._zod.def.type === 'string') return [path];
  if (schema._zod.def.type === 'array') return textPaths(schema._zod.def.element, [...path, 0]);
  if (schema._zod.def.type === 'object') return Object.entries(schema.shape)
    .flatMap(([key, child]) => textPaths(child, [...path, key]));
  return [];
}

function setAt(base, path, value) {
  const copy = structuredClone(base);
  let current = copy;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const next = path[index + 1];
    if (current[key] === undefined) current[key] = typeof next === 'number' ? [] : {};
    current = current[key];
  }
  current[path.at(-1)] = value;
  return copy;
}

async function filesText(folder) {
  let result = '';
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    result += entry.isDirectory() ? await filesText(path) : await readFile(path, 'utf8');
  }
  return result;
}

fakeOpenAI.listen(0, '127.0.0.1');
await once(fakeOpenAI, 'listening');
process.env.PORT = '0';
process.env.OPENAI_API_KEY = 'fixture';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${fakeOpenAI.address().port}/v1`;
process.env.FEEDBACK_FILE = join(dir, 'feedback.jsonl');
process.env.SESSION_EVENTS_FILE = join(dir, 'sessions.jsonl');
process.env.DOCS_ROOT = new URL('../', import.meta.url).pathname;
const { httpServer } = await import('./http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
let sent = 0;
const post = (endpoint, body) => fetch(`http://127.0.0.1:${httpServer.address().port}${endpoint}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${++sent}` },
  body: JSON.stringify(body),
});

try {
  const cases = [
    ['/assistant', assistantRequestSchema, { question: 'Como criar campanha?', sessionId: 'fixture-session-1' }],
    ['/feedback', feedbackInputSchema, { type: 'assistant', value: 'up', path: '/assistente' }],
    ['/assistant', sessionEventSchema, { question: 'Como criar campanha?', sessionId: 'fixture-session-2' }],
  ];
  for (const [endpoint, schema, base] of cases) {
    const paths = textPaths(schema);
    assert.ok(paths.length, `${endpoint} precisa expor campos de texto no schema`);
    for (const path of paths) {
      for (const marker of [secret, phone]) {
        const body = setAt(base, path, marker);
        const response = await post(endpoint, body);
        assert.ok([200, 201, 400].includes(response.status), `${endpoint} ${path.join('.')} recebeu ${response.status}`);
        const output = `${providerInputs.join('\n')}\n${await filesText(dir)}`;
        assert.ok(!output.includes(marker), `${endpoint} ${path.join('.')} vazou sentinela`);
      }
    }
  }
} finally {
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => fakeOpenAI.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
console.log('Schema boundary: campos de texto não vazam ao provider nem aos arquivos.');
