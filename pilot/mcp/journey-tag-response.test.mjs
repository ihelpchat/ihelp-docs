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

const link = { id: 733, contatoId: 17, tagsId: 33, empresaId: 42 };
const context = { name, realCompany: true, requestContactId: '17', expectedContactId: 17,
  ownedContact: true, companyId: '42' };

test('resposta real de vínculo usa tagsId, nunca o ID do vínculo', () => {
  assert.equal(tagIdFromCreateResponse(link, context), 33, 'TagsId criado pertence ao contato desta execução');
});

for (const [label, row, options] of [
  ['contato divergente na resposta', { ...link, contatoId: 99 }, context],
  ['contato divergente na requisição', link, { ...context, requestContactId: '99' }],
  ['contato sem prova de criação', link, { ...context, ownedContact: false }],
  ['empresa divergente', { ...link, empresaId: 43 }, context],
  ['empresa ausente', { ...link, empresaId: null }, context],
  ['ID da tag ausente', { ...link, tagsId: null }, context],
  ['ID da tag não numérico', { ...link, tagsId: '33' }, context],
  ['tag existente na requisição', link, { ...context, requestedId: 33 }],
  ['modo antigo sem autorização de empresa real', link, { ...context, realCompany: false }],
]) test(`resposta de vínculo recusada: ${label}`, () => {
  assert.equal(tagIdFromCreateResponse(row, options), null);
});

test('resposta desconhecida sem nome não confunde o ID do vínculo com uma tag', () => {
  assert.equal(tagIdFromCreateResponse(link), null);
});
