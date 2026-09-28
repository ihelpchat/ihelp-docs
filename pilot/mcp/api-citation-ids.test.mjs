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
  assert.deepEqual(service.resolveApiCitationIds([fact[0]], registry).citations, [fact[1].citation]);
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
