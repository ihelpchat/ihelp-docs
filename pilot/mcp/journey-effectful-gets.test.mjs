import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { productionEffectfulGetDenied } from './journey-runtime.mjs';

const inventoryPath = new URL('./production-effectful-gets.json', import.meta.url);

test('inventário versionado existe', () => {
  assert.equal(existsSync(inventoryPath), true);
});

const inventory = existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath)) : null;

test('GET que abre atendimentos é bloqueado', () => {
  assert.equal(productionEffectfulGetDenied('/api/v2/bot/opencall-contacts'), true);
});

test('inventário de GETs do back tem origem, data e cobertura completa', () => {
  if (!inventory) return;
  assert.match(inventory.auditedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.match(inventory.backend.releaseValidation.sha, /^[a-f0-9]{40}$/u);
  assert.match(inventory.backend.production.sha, /^[a-f0-9]{40}$/u);
  assert.equal(inventory.totalGet, 337);
  assert.equal(new Set(inventory.effectfulRoutes).size, inventory.effectfulRoutes.length);
  assert.ok(inventory.effectfulRoutes.includes('/api/v2/bot/opencall-contacts'));
});

test('todo GET com efeito é bloqueado pelo guard de produção', () => {
  if (!inventory) return;
  for (const route of inventory.effectfulRoutes) {
    const path = route.replace(/:id\b/gu, '123');
    assert.equal(productionEffectfulGetDenied(path), true, path);
  }
});

test('inventário não encolhe sem data e origem novas', () => {
  if (!inventory) return;
  const baseline = { auditedAt: '2026-10-10', releaseSha: 'f0a926e881eba56cd8aac250f39e75760c095e95',
    productionSha: '88bc6c58dd27d7bd53b1ec48dc821ac436762c13', minimum: 1 };
  assert.ok(inventory.effectfulRoutes.length >= baseline.minimum
    || (inventory.auditedAt !== baseline.auditedAt
      && inventory.backend.releaseValidation.sha !== baseline.releaseSha
      && inventory.backend.production.sha !== baseline.productionSha));
});
