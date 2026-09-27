import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';

const file = 'Controllers/TestController.cs';
const dtoSources = [
  { file: 'Domain/Filters.cs', source: 'public class Filters { public int BusinessId { get; set; } public Paging Paging { get; set; } }' },
  { file: 'Domain/Other.cs', source: 'public class Other { public int BusinessId { get; set; } }' },
  { file: 'Domain/Paging.cs', source: 'public class Paging { public int Limit { get; set; } }' },
];
const action = (body) => `[Route("api/v2/test")] public class TestController {
 [HttpGet] public object Get([FromQuery] Filters filters, [FromQuery] Other other) {
  ${body}
  return Ok(filters);
 }
}`;
const fields = (body) => {
  const endpoint = readCsharpEndpoints(action(body), file, { dtoSources })[0];
  return {
    parameters: endpoint.parameters.map(({ name }) => name),
    serverAssigned: endpoint.serverAssigned.map(({ name }) => name),
  };
};

test('atribuição em other não esconde BusinessId de filters', () => {
  assert.deepEqual(fields('other.BusinessId = GetBusinessId();'), {
    parameters: ['businessId', 'paging'], serverAssigned: ['businessId'],
  });
});

test('atribuição no próprio filters remove apenas seu campo', () => {
  assert.deepEqual(fields('filters.BusinessId = GetBusinessId();'), {
    parameters: ['paging', 'businessId'], serverAssigned: ['businessId'],
  });
});

for (const [label, body] of [
  ['comparação', 'if (filters.BusinessId == x) { }'],
  ['variável local', 'var f = new Filters(); f.BusinessId = GetBusinessId();'],
  ['this', 'this.BusinessId = GetBusinessId();'],
]) test(`${label} não marca campo da action`, () => {
  assert.deepEqual(fields(body), {
    parameters: ['businessId', 'paging', 'businessId'], serverAssigned: [],
  });
});

for (const body of [
  'filters = filters with { BusinessId = GetBusinessId() };',
  'filters = new Filters { BusinessId = GetBusinessId() };',
  'filters.BusinessId ??= GetBusinessId();',
]) test(`${body} atribui apenas filters`, () => {
  assert.deepEqual(fields(body), {
    parameters: ['paging', 'businessId'], serverAssigned: ['businessId'],
  });
});

test('caminho aninhado afeta somente paging.limit', () => {
  assert.deepEqual(fields('filters.Paging.Limit = 50;'), {
    parameters: ['businessId', 'paging', 'businessId'], serverAssigned: ['paging.limit'],
  });
});
