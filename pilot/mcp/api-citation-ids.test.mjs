import test from 'node:test';
import assert from 'node:assert/strict';
import * as service from './content-ai-service.mjs';

const sha = 'a'.repeat(40);
const path = 'Controllers/ContactsController.cs';
const context = {
  module: 'api', request: { description: 'Criar páginas de Contatos.', details: 'Os filtros são opcionais.' },
  matches: [{ repository: 'backend', path, sha, ref: sha, line: 10, excerpt: '10: public class ContactsController' }],
  callEvidence: [{ repository: 'backend', path, sha, ref: sha, start: 20, end: 21,
    excerpt: 'Response.Headers.Append("Total-Pages", total);\nreturn contacts;' }],
  endpoints: [{ repository: 'backend', sha, verb: 'GET', route: '/contacts', responseHeaders: [
    { name: 'Total-Pages', source: `${path}:20` }], parameters: [] }],
  existing: [{ path: 'api/contatos/existente', title: 'Contatos', body: 'A página existente lista contatos.' }],
};

test('IDs resolvem fontes sem pedir linha ou quote ao modelo', () => {
  assert.equal(typeof service.apiCitationRegistry, 'function');
  assert.equal(typeof service.resolveApiCitationIds, 'function');
  const registry = service.apiCitationRegistry(context);
  for (const prefix of ['C', 'R', 'P', 'F']) assert.ok([...registry.keys()].some((id) => id.startsWith(prefix)));
  const fact = [...registry.entries()].find(([, entry]) => entry.kind === 'fact' && entry.text.includes('Total-Pages'));
  assert.ok(fact);
  assert.equal(fact[1].citation.lineStart, 20);
  assert.deepEqual(service.resolveApiCitationIds([fact[0]], registry).citations,
    [{ ...fact[1].citation, citationId: fact[0] }]);
});

test('ID inexistente e fato derivado sem trecho de código são recusados', () => {
  assert.equal(typeof service.apiCitationRegistry, 'function');
  assert.equal(typeof service.resolveApiCitationIds, 'function');
  const registry = service.apiCitationRegistry(context);
  assert.ok(service.resolveApiCitationIds(['F999'], registry).issues.length);
  const detached = service.apiCitationRegistry({ ...context, endpoints: [{ ...context.endpoints[0],
    responseHeaders: [{ name: 'Detached', source: `${path}:999` }] }] });
  assert.equal([...detached.values()].some((item) => item.kind === 'fact' && item.text.includes('Detached')), false);
});

test('citação R não sustenta fato técnico novo', () => {
  assert.equal(typeof service.apiCitationRegistry, 'function');
  assert.equal(typeof service.resolveApiCitationIds, 'function');
  const registry = service.apiCitationRegistry(context);
  const requestId = [...registry.keys()].find((id) => id.startsWith('R'));
  assert.ok(service.resolveApiCitationIds([requestId], registry, 'O campo `secretKey` é obrigatório.').issues.length);
});

test('índice enviado ao modelo passa pela higiene de código', () => {
  const registry = service.apiCitationRegistry({ ...context, matches: [{ ...context.matches[0],
    excerpt: '10: var secret = "postgres://u:p@host/db";' }] });
  const prompt = service.apiCitationPrompt(registry);
  assert.doesNotMatch(prompt, /postgres:\/\//u);
  assert.match(prompt, /literal omitido/u);
});

test('pacote API usa IDs na geração e guarda citação completa só na revisão interna', async () => {
  const request = { module: 'api', topic: 'Contatos', description: 'Criar GET /contacts. Consulte contatos disponíveis.' };
  const productContext = { ...context, groundingRequired: true, code: [{ available: true }],
    endpoints: [{ ...context.endpoints[0], public: true, documented: true, explicit: true,
      authorization: 'authenticated', responseFields: [] }],
    apiExamples: [{ sections: ['Resposta'], components: ['Fields', 'Field'] }] };
  const unit = (text, citations = ['C1']) => ({ text, citations, refs: [] });
  const article = { path: 'api/contatos/buscar', endpoint: 'GET /contacts', title: 'Buscar contatos',
    description: unit('Consulta os contatos disponíveis na referência pública da API.'),
    intro: unit('Use esta consulta para listar contatos.'), notas: [], responseHeaders: [],
    responseDescriptions: [], parameterDescriptions: [] };
  const value = { status: 'ready', summary: [unit('Consulte contatos disponíveis.', ['R2'])],
    questions: [], articles: [article] };
  let prompt;
  const result = await service.generateContentPackage(process.cwd(), request, { productContext,
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      prompt = payload.input[1].content;
      return { output_text: JSON.stringify(value), model: 'fixture' };
    } } } });
  assert.match(prompt, /C1 \[code\]/u);
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.articles.length, 1);
  assert.ok(result.internalCitations.some((item) => item.ids.includes('C1') && item.citations[0].sha === sha));
  assert.doesNotMatch(result.articles[0].body, /citationId|Controllers\/ContactsController/u);
});
