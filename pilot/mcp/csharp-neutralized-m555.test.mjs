import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';

const file = 'Controllers/TestController.cs';
const dtoSources = [{ file: 'Domain/Filters.cs', source: 'public class Filters { public int BusinessId { get; set; } }' }];
const base = 'filters.BusinessId = GetBusinessId();';
const action = (assignment, route = 'a') => `[Route("api/v2/test")] public class TestController {
 [HttpGet("${route}")] public object Get([FromQuery] Filters filters) {
  ${assignment}
  return Ok(filters);
 }
}`;
const result = (assignment, route) => readCsharpEndpoints(action(assignment, route), file, { dtoSources })[0];

test('atribuição executável do filtro pertence ao servidor', () => {
  const endpoint = result(base);
  assert.equal(endpoint.parameters.some(({ name }) => name === 'businessId'), false);
  assert.equal(endpoint.serverAssigned.some(({ name }) => name === 'businessId'), true);
});

for (const [name, assignment] of [
  ['comentário de linha', `// ${base}`],
  ['comentário de bloco', `/* ${base} */`],
  ['string', `var example = "${base}";`],
]) test(`${name} não atribui filtro no servidor`, () => {
  const endpoint = result(assignment);
  assert.equal(endpoint.parameters.some(({ name }) => name === 'businessId'), true);
  assert.equal(endpoint.serverAssigned.some(({ name }) => name === 'businessId'), false);
});

test('literal da rota preserva duas barras', () => {
  const endpoint = result(base, 'a//b');
  assert.equal(endpoint.route, '/api/v2/test/a//b');
  assert.equal(endpoint.serverAssigned.some(({ name }) => name === 'businessId'), true);
});
