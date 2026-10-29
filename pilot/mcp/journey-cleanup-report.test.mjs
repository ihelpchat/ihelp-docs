import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupCreatedItems } from './journey-service.mjs';

test('relatório de limpeza preserva os IDs textuais registrados na criação e exclusão', async () => {
  const items = [{ kind: 'contact', id: 'created-17' }, { kind: 'robot', id: 'robot-23' }, { kind: 'tag', id: 33 }];
  const removed = [];
  const result = await cleanupCreatedItems(items, async item => removed.push(item.id));
  assert.deepEqual(result.created, items, 'IDs criados precisam continuar auditáveis no relatório');
  assert.deepEqual(result.deleted, items);
  assert.deepEqual(removed, ['created-17', 'robot-23', 33]);
  assert.deepEqual(result.pending, []);
});

test('relatório de limpeza mantém o ID textual quando a remoção falha', async () => {
  const items = [{ kind: 'contact', id: 'created-17' }];
  const result = await cleanupCreatedItems(items, async () => { throw Error('falha simulada'); });
  assert.deepEqual(result.created, items, 'ID criado precisa permanecer auditável mesmo com pendência');
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.pending, [{ kind: 'contact', id: 'created-17', reason: 'remoção não confirmada' }]);
});

test('relatório de limpeza mantém IDs numéricos já aceitos', async () => {
  const items = [{ kind: 'contact', id: 17 }, { kind: 'tag', id: 33 }];
  const result = await cleanupCreatedItems(items, async () => {});
  assert.deepEqual(result.created, items);
  assert.deepEqual(result.deleted, items);
  assert.deepEqual(result.pending, []);
});

test('relatório de limpeza não expõe ID inválido nem autoriza sua exclusão', async () => {
  const items = [null, '../foreign', 'a'.repeat(81), 'nome livre', {}, NaN, 1.5].map(id => ({ kind: 'contact', id }));
  const removed = [];
  const result = await cleanupCreatedItems(items, async item => removed.push(item.id));
  assert.deepEqual(removed, []);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.created, items.map(({ kind }) => ({ kind, id: null })));
  assert.deepEqual(result.pending, items.map(({ kind }) => ({ kind, reason: 'id de resposta ausente' })));
});
