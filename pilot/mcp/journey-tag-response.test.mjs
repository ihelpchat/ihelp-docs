import test from 'node:test';
import assert from 'node:assert/strict';
import { tagIdFromCreateResponse } from './journey-tag-response.mjs';

const name = 'Teste FAQ Tag Exemplo 01';

test('resposta antiga com nome preserva o ID da tag', () => {
  assert.equal(tagIdFromCreateResponse({ id: 33, nome: name }, { name }), 33);
  assert.equal(tagIdFromCreateResponse({ id: 33, tagName: name }, { name }), 33);
});

test('resposta antiga de outro nome não fornece ID', () => {
  assert.equal(tagIdFromCreateResponse({ id: 33, nome: 'Outra tag' }, { name }), null);
});

test('resposta ausente não fornece ID', () => {
  assert.equal(tagIdFromCreateResponse(null, { name }), null);
});
