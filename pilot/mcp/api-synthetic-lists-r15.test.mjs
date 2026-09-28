import test from 'node:test';
import assert from 'node:assert/strict';
import { renderApiReference } from './api-reference-render.mjs';

const endpoint = {
  verb: 'GET', route: '/api/v2/example', authorization: 'authenticated',
  parameters: [], responseEnvelope: 'dados', responseList: false,
  responseFields: [
    { name: 'ids', path: 'dados.ids', type: 'List<int>' },
    { name: 'codes', path: 'dados.codes', type: 'int[]' },
    { name: 'longIds', path: 'dados.longIds', type: 'IEnumerable<long>' },
    { name: 'flags', path: 'dados.flags', type: 'List<bool>' },
    { name: 'labels', path: 'dados.labels', type: 'List<string>' },
    { name: 'items', path: 'dados.items', type: 'List<ItemDto>' },
    { name: 'count', path: 'dados.items[].count', type: 'int' },
    { name: 'enabled', path: 'dados.items[].enabled', type: 'bool' },
    { name: 'name', path: 'dados.items[].name', type: 'string' },
  ],
};

const renderedJson = (fact) => {
  const body = renderApiReference(fact, [], { sections: ['Resposta'], components: ['Fields', 'Field'] }).body;
  return JSON.parse(body.match(/```json\n([\s\S]*?)\n```/u)?.[1] ?? 'null');
};

test('página completa gera elementos de listas pelo tipo e campos do DTO', () => {
  assert.deepEqual(renderedJson(endpoint), { dados: {
    ids: [1, 2], codes: [1, 2], longIds: [1, 2], flags: [false], labels: ['exemplo'],
    items: [{ count: 1, enabled: false, name: 'Maria Exemplo' }],
  } });
});

test('cada troca isolada de tipo altera somente a lista correspondente', () => {
  const positive = renderedJson(endpoint).dados;
  for (const name of ['ids', 'codes', 'longIds', 'flags']) {
    const negative = { ...endpoint, responseFields: endpoint.responseFields.map((field) =>
      field.name === name ? { ...field, type: 'List<string>' } : field) };
    const changed = renderedJson(negative).dados;
    assert.deepEqual(Object.keys(changed).filter((key) => JSON.stringify(changed[key]) !== JSON.stringify(positive[key])), [name]);
    assert.deepEqual(changed[name], ['exemplo']);
  }
});
