import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';
import { journeyRequestAllowed, observeJourneyDom } from './journey-runtime.mjs';

test('fichas opacas omitem placeholder, opção vazia e opção desabilitada', async () => {
  const browser = await chromium.launch({ executablePath: chromeExecutablePath(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div role="option" data-value="">Selecione...</div><div role="option" data-value="7">Teste</div><div role="option" data-value="8" aria-disabled="true">Indisponível</div>');
    const screen = await observeJourneyDom(page);
    assert.deepEqual(screen.controls.filter((item) => item.role === 'option').map((item) => item.name), ['opção 1']);
  } finally { await browser.close(); }
});

test('PUT owner barra IDs ausentes e IDs fora da fixture antes da rede', () => {
  const request = (body) => ({ method: () => 'PUT', url: () => 'https://qa.example.test/api/v2/contacts/ref-1/owner',
    postData: () => JSON.stringify(body) });
  const context = { apiOrigin: 'https://qa.example.test', taskId: 'contatos.definir_responsavel',
    createdIds: new Set(['ref-1']), fixedIds: { department: new Set([7]), user: new Set([8]) } };
  assert.equal(journeyRequestAllowed(request({ departmentId: 7, userId: 8 }), context), true);
  for (const body of [{ userId: 8 }, { departmentId: 7 }, { departmentId: null, userId: 8 },
    { departmentId: 70, userId: 8 }, { departmentId: 7, userId: 80 }])
    assert.equal(journeyRequestAllowed(request(body), context), false);
});
