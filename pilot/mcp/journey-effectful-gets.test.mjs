import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { handleJourneyRoute, productionEffectfulGetDenied } from './journey-runtime.mjs';
import { productionConfig } from './journey-production.mjs';

const inventoryPath = new URL('./production-effectful-gets.json', import.meta.url);

test('inventário versionado existe', () => {
  assert.equal(existsSync(inventoryPath), true);
});

const inventory = existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath)) : null;

test('GET que abre atendimentos é bloqueado', () => {
  assert.equal(productionEffectfulGetDenied('/api/v2/bot/opencall-contacts'), true);
  assert.equal(productionEffectfulGetDenied('/api/v2/crm/company-profile'), true);
});

test('inventário de GETs do back tem origem, data e cobertura completa', () => {
  if (!inventory) return;
  assert.match(inventory.auditedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.match(inventory.backend.releaseValidation.sha, /^[a-f0-9]{40}$/u);
  assert.match(inventory.backend.production.sha, /^[a-f0-9]{40}$/u);
  assert.equal(inventory.totalGet, 347);
  assert.equal(inventory.getEndpoints.length, inventory.totalGet);
  assert.equal(inventory.getEndpoints.filter(({ effectful }) => effectful).length, inventory.effectfulGet);
  assert.deepEqual([...new Set(inventory.getEndpoints.filter(({ effectful }) => effectful)
    .map(({ route }) => route))].sort(), inventory.effectfulRoutes);
  assert.equal(new Set(inventory.effectfulRoutes).size, inventory.effectfulRoutes.length);
  assert.ok(inventory.effectfulRoutes.includes('/api/v2/bot/opencall-contacts'));
});

test('todo GET com efeito é bloqueado pelo guard de produção', () => {
  if (!inventory) return;
  for (const route of inventory.effectfulRoutes) {
    const path = route.replace(/:id\??/gu, '123');
    assert.equal(productionEffectfulGetDenied(path), true, path);
  }
  assert.equal(productionEffectfulGetDenied('/ws/chat/convert/123'), true);
  assert.equal(productionEffectfulGetDenied('/r/123'), true);
  assert.equal(productionEffectfulGetDenied('/api/v2/company'), false);
});

test('runner de produção nega cada GET inventariado, mesmo após o pré-voo', async () => {
  if (!inventory) return;
  const env = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: 'https://front.example.test',
    QA_PROD_ALLOWED_HOSTS: 'front.example.test,api.example.test', QA_PROD_EMAIL: 'qa@example.test',
    QA_PROD_PASSWORD: 'fictional-password' };
  for (const pattern of inventory.effectfulRoutes) {
    const path = pattern.replace(/:id\??/gu, '123');
    let outcome;
    await handleJourneyRoute({ request: () => ({ method: () => 'GET',
      url: () => `https://api.example.test${path}` }),
    abort: async () => { outcome = 'abort'; }, fallback: async () => { outcome = 'fallback'; } }, {
      apiOrigin: 'https://api.example.test', target: productionConfig(env).target, env,
      thirdPartyDenied: {}, taskId: 'contatos.cadastrar', productionReady: () => true,
      onBlocked: () => {},
    });
    assert.equal(outcome, 'abort', path);
  }
});

test('inventário não encolhe sem data e origem novas', () => {
  if (!inventory) return;
  const baseline = { auditedAt: '2026-10-10', releaseSha: 'af982c8795115045d00a8b6b862c6e6a4b0c69f9',
    productionSha: 'da2e55cbf0b944284a0193eb38478173e308a92f', minimum: 47 };
  assert.ok(inventory.effectfulRoutes.length >= baseline.minimum
    || (inventory.auditedAt !== baseline.auditedAt
      && inventory.backend.releaseValidation.sha !== baseline.releaseSha
      && inventory.backend.production.sha !== baseline.productionSha));
});
