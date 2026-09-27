import test from 'node:test';
import assert from 'node:assert/strict';
import { generateContentPackage } from './content-ai-service.mjs';
import { internalTypeIssue } from './api-reference-render.mjs';

// Exact offending field prose from the real m557g resp-2 replay.
const badDescription = 'Campo lastActivity do contato, tipado como DateTime anulável no DTO.';
const unit = (text) => ({ text, citations: [] });
const endpoint = (route, field) => ({ verb: 'GET', route, public: true, documented: true,
  authorization: 'authenticated', parameters: [], responseFields: [{ name: field, type: 'string' }] });
const endpoints = [endpoint('/api/v2/contacts', 'id'), endpoint('/api/v2/contacts/details', 'lastActivity')];
const article = (path, id, name, text) => ({ path, endpoint: id, title: 'Contatos',
  description: unit('Consulta os dados dos contatos disponíveis na referência pública da API.'), intro: unit('Use para consultar contatos.'), notas: [],
  responseDescriptions: [{ name, description: unit(text) }] });
const original = { status: 'ready', summary: 'Contatos.', questions: [], grounding: [], articles: [
  article('api/contatos/buscar-contatos', 'GET /contacts', 'id', 'Identificador do contato.'),
  article('api/contatos/buscar-detalhes-do-contato', 'GET /contacts/details', 'lastActivity', badDescription),
] };

async function run(first = original, second = structuredClone(original), groundingRequired = false) {
  let calls = 0;
  let retryText = '';
  const result = await generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos' }, {
    productContext: { groundingRequired, matches: groundingRequired ? [{ repository: 'ihelpchat/olah-ihelp', path: 'Contacts.cs', line: 1, sha: 'test', ref: 'test' }] : [],
      code: groundingRequired ? [{ available: true }] : [], endpoints,
      apiExamples: [{ sections: ['Resposta'], components: ['Fields', 'Field'] }] },
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      calls++;
      if (calls > 2) throw new Error('terceira geração proibida');
      if (calls === 2) retryText = payload.input.at(-1).content;
      return { output_text: JSON.stringify(calls === 1 ? first : second), model: 'replay' };
    } } },
  });
  return { result, calls, retryText };
}

test('resp-2 DateTime recebe uma nova tentativa e a resposta corrigida fica ready', async () => {
  const fixed = structuredClone(original);
  fixed.articles[1].responseDescriptions[0].description.text = 'Data e hora da última atividade do contato.';
  const { result, calls, retryText } = await run(original, fixed);
  assert.equal(calls, 2);
  assert.match(retryText, /tipo interno na prosa: DateTime; use a descrição pública/u);
  assert.equal(result.status, 'ready', result.summary);
});

test('problema persistente conserva status e lista após exatamente duas gerações', async () => {
  const { result, calls } = await run();
  assert.equal(calls, 2);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /tipo interno na prosa: DateTime/u);
});

test('problemas em páginas distintas entram juntos no retry', async () => {
  const first = structuredClone(original);
  first.articles[0].intro.text = 'Use o DTO para consultar contatos.';
  const fixed = structuredClone(first);
  fixed.articles[0].intro.text = 'Use para consultar contatos.';
  fixed.articles[1].responseDescriptions[0].description.text = 'Data e hora da última atividade do contato.';
  const { result, calls, retryText } = await run(first, fixed);
  assert.equal(calls, 2);
  assert.match(retryText, /termo interno na prosa: DTO/u);
  assert.match(retryText, /tipo interno na prosa: DateTime/u);
  assert.equal(result.status, 'ready', result.summary);
});

test('redação e grounding de páginas distintas entram no mesmo retry', async () => {
  const { calls, retryText } = await run(original, original, true);
  assert.equal(calls, 2);
  assert.match(retryText, /tipo interno na prosa: DateTime/u);
  assert.match(retryText, /frase sem citação: Use para consultar contatos/u);
});

test('tipos anuláveis e coleções usam a tabela pública do renderizador', () => {
  assert.match(internalTypeIssue('Campo DateTime?'), /DateTime\?; use a descrição pública \(data e hora\)/u);
  assert.match(internalTypeIssue('Campo int?'), /int\?; use a descrição pública \(número\)/u);
  assert.match(internalTypeIssue('Campo List<string>'), /List<string>; use a descrição pública \(lista\)/u);
  assert.match(internalTypeIssue('Campo IEnumerable<Guid?>'), /IEnumerable<Guid\?>; use a descrição pública \(lista\)/u);
});
