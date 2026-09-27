import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeCodeForModel } from './code-hygiene.mjs';
import { containsSensitiveData, redactSensitiveData } from './sensitive-data.mjs';
import { planContent } from './content-ai-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const sha = 'a'.repeat(40);
const endpoint = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  explicit: true, parameters: [{ name: 'limit', default: 20 }], serverAssigned: [{ name: 'businessId', serverAssigned: true }] };
const safe = 'const sql = "WHERE ContactId = @id"; const route = "/api/v2/contacts/{contactId}"; const message = "Contato não encontrado."; ///<summary> Busca contatos </summary>';

async function payloadFor(excerpt) {
  let payload;
  const result = await planContent(root, { topic: 'Contatos', module: 'api', description: 'GET /api/v2/contacts' }, {
    productContext: { groundingRequired: false, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [], apiExamples: [], pending: [], endpoints: [endpoint],
      callEvidence: [{ repository: 'backend', path: 'ContactsSqlBuilder.cs', start: 1, end: 1, sha, ref: sha, excerpt }] },
    client: { responses: { create: async (input) => {
      payload = JSON.stringify(input);
      return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
    } } },
  });
  return { payload, result };
}

test('allowlist de literais e comentários chega ao payload com contadores', async () => {
  const positive = await payloadFor(safe);
  for (const value of ['WHERE ContactId = @id', '/api/v2/contacts/{contactId}', 'Contato não encontrado.', 'Busca contatos'])
    assert.ok(positive.payload.includes(value), value);
  assert.deepEqual(positive.result.codeHygiene, { literalsOmitted: 0, commentsRemoved: 0 });
  for (const secret of ['postgres://u:p@host/db', 'mongodb+srv://u:p@c.x.net', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9d', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature']) {
    const changed = safe.replace('Contato não encontrado.', secret);
    const negative = await payloadFor(changed);
    assert.equal(negative.payload.includes(secret), false, secret);
    assert.match(negative.payload, /<literal omitido>/u);
    assert.deepEqual(negative.result.codeHygiene, { literalsOmitted: 1, commentsRemoved: 0 });
  }
  for (const comment of ['// senha antiga: hunter2', '/* Pwd=abc */']) {
    const negative = await payloadFor(`${safe}\n${comment}`);
    assert.equal(negative.payload.includes(comment), false);
    assert.equal(negative.result.codeHygiene.commentsRemoved, 1);
  }
});

test('literais verbatim e interpolados são filtrados por parte', () => {
  const source = 'var a = @"postgres://u:p@host/db"; var b = $"Contatos {id}: {"mongodb+srv://u:p@c.x.net"}";';
  const result = sanitizeCodeForModel(source);
  assert.equal(result.text.includes('postgres://'), false);
  assert.equal(result.text.includes('mongodb+srv://'), false);
  assert.equal(result.literalsOmitted, 2);
  assert.equal(sanitizeCodeForModel('var safe = $"Contato {id} encontrado";').text, 'var safe = $"Contato {id} encontrado";');
});

test('fatos estruturados continuam iguais com higiene de evidência', async () => {
  const { payload } = await payloadFor('return "postgres://u:p@host/db";');
  const user = JSON.parse(payload).input.find((item) => item.role === 'user').content;
  assert.match(user, /"default":20/u);
  assert.match(user, /"serverAssigned":true/u);
  assert.equal(payload.includes('postgres://'), false);
});

test('URL userinfo de qualquer esquema é detectada e redigida', () => {
  const positive = 'postgres://u:p@host/db';
  const negative = 'postgres://u:p/host/db';
  assert.equal(containsSensitiveData(positive, { detectOpaque: true }), true);
  assert.equal(containsSensitiveData(negative, { detectOpaque: true }), false);
  assert.equal(redactSensitiveData(positive).includes('u:p@'), false);
});

test('arquitetura: evidência entra no prompt somente pela higiene', () => {
  const source = readFileSync(new URL('./content-ai-service.mjs', import.meta.url), 'utf8');
  const requestText = source.slice(source.indexOf('function requestText('), source.indexOf('function pageMatchesEndpoint('));
  assert.match(requestText, /sanitizeCodeForModel/u);
  assert.doesNotMatch(requestText, /redactSensitiveData\(item\.excerpt\)/u);
  assert.equal((source.match(/item\.excerpt/gu) ?? []).length, 2);
  assert.equal((requestText.match(/safeCode\(item\.excerpt\)/gu) ?? []).length, 2);
});
