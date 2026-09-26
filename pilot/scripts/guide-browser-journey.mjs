import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './visual/measure.mjs';
import { createSitePage } from './visual/serve-qa-build.mjs';

const root = await mkdtemp(join(tmpdir(), 'guide-browser-'));
await mkdir(join(root, 'content/docs'), { recursive: true });
await writeFile(join(root, 'content/docs/qr.mdx'), `---
title: Reconectar canal
guide:
  schemaVersion: 1
  guideId: reconectar-canal-qr
  version: 1
  mode: real
  initialStepId: inicio
  steps:
    - stepId: inicio
      text: Abra o WhatsApp no celular.
    - stepId: escolha
      text: Qual celular você usa?
      choices:
        - id: android
          label: Usar Android
          nextStepId: android
        - id: iphone
          label: Usar iPhone
          nextStepId: iphone
    - stepId: android
      text: Toque nos três pontinhos.
    - stepId: iphone
      text: Abra Configurações.
    - stepId: confirmar
      text: Confirme a conexão.
---
Fixture sem dados reais.
`);

let providerCalls = 0;
const provider = createServer((_request, response) => {
  providerCalls += 1;
  response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
process.env.PORT = '0';
process.env.DOCS_ROOT = root;
process.env.OPENAI_API_KEY = 'fixture';
process.env.DOCS_MCP_API_KEY = 'fixture-mcp-key-abcdefghijklmnopqrstuvwxyz';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
process.env.SESSION_EVENTS_FILE = join(root, 'sessions.jsonl');
const { httpServer } = await import('../mcp/http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
const endpoint = `http://127.0.0.1:${httpServer.address().port}/assistant`;
let serial = 0;
async function post(body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${++serial}` },
    body: JSON.stringify({ sessionId: `browser-seed-${serial}`, origin: 'faq', ...body }),
  });
  if (response.status !== 200) throw new Error(`assistant HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

const sitePort = 4178;
const site = spawn('node_modules/.bin/serve', [process.env.GUIDE_QA_OUT ?? 'out', '-l', String(sitePort)], { cwd: new URL('../', import.meta.url).pathname, stdio: 'ignore' });
const siteUrl = `http://127.0.0.1:${sitePort}`;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
let browser;
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (site.exitCode !== null) throw new Error(`serve saiu com ${site.exitCode}`);
    try { if ((await fetch(siteUrl)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (attempt === 49) throw new Error('serve não iniciou');
  }
  browser = await launch();
  const requests = [];
  const replies = [];
  async function pageWith(reply) {
    const page = await createSitePage(browser, siteUrl, basePath);
    page.on('pageerror', (error) => console.error('browser pageerror', error.message));
    await page.route(process.env.GUIDE_QA_ASSISTANT_URL ?? '**/assistant', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
        return;
      }
      const body = route.request().postDataJSON();
      requests.push(body);
      const result = await post(body);
      replies.push(result);
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) });
    });
    await page.addInitScript((initial) => sessionStorage.setItem('ih-assistant-v1', JSON.stringify({ messages: [
      { id: 'fixture-ai', role: 'ai', reply: initial, question: 'Começar' },
    ], scope: 'Tudo', sessionId: `browser-${Math.random().toString(36).slice(2)}` })), {
      sections: [], code: null, ...reply,
      sources: (reply.sources ?? []).map((source) => ({ kind: 'Ajuda', ...source })),
    });
    await page.goto(`${siteUrl}${basePath}/assistente/`);
    try { await page.locator('.ih-ai-row .ih-ai-text').last().waitFor({ timeout: 5000 }); }
    catch (error) {
      console.error('page diagnostic', await page.evaluate(() => ({ url: location.href, stored: sessionStorage.getItem('ih-assistant-v1')?.slice(0, 200), body: document.body.innerText.slice(0, 500) })));
      throw error;
    }
    return page;
  }
  async function click(page, label, { choiceId, stepId, guideId = 'reconectar-canal-qr', resolution } = {}) {
    const before = requests.length;
    const rows = await page.locator('.ih-ai-row .ih-ai-text').count();
    await page.locator('.ih-ai-row').last().getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll('.ih-ai-row .ih-ai-text').length > count, rows);
    assert.equal(requests.length, before + 1, `${label}: uma chamada HTTP`);
    assert.equal(requests.at(-1).guide?.guideId, guideId, `${label}: perdeu guideId`);
    if (stepId) assert.equal(requests.at(-1).guide?.stepId, stepId, `${label}: stepId enviado`);
    if (choiceId) assert.equal(requests.at(-1).guide?.choiceId, choiceId, `${label}: escolha enviada`);
    if (resolution) assert.equal(replies.at(-1).resolution, resolution, `${label}: resultado do servidor`);
    assert.equal(providerCalls, 0, `${label}: chamou provider`);
  }
  async function support(page, guideId, stepId) {
    const href = await page.locator('.ih-ai-row').last().getByRole('link', { name: 'Falar com o atendimento' }).getAttribute('href');
    const message = new URL(href).searchParams.get('text');
    assert.match(message, new RegExp(`Guia: ${guideId}${stepId ? `; passo: ${stepId}` : ''}`, 's'), 'CTA visível deve informar contexto validado');
  }

  const initial = await post({ question: 'Começar', guide: { guideId: 'reconectar-canal-qr', stepId: 'inicio', version: 1, mode: 'real' } });
  const page = await pageWith(initial);
  assert.equal(await page.locator('.ih-ai-row').last().getByRole('button', { name: 'Voltar', exact: true }).count(), 0, 'Voltar não aparece no primeiro passo');
  await support(page, 'reconectar-canal-qr', 'inicio');
  await click(page, 'Concluí este passo', { stepId: 'inicio' });
  await support(page, 'reconectar-canal-qr', 'escolha');
  await click(page, 'Usar Android', { stepId: 'escolha', choiceId: 'android' });
  await support(page, 'reconectar-canal-qr', 'android');
  await click(page, 'Concluí este passo', { stepId: 'android' });
  await support(page, 'reconectar-canal-qr', 'confirmar');
  await click(page, 'Voltar', { stepId: 'confirmar' });
  assert.match(await page.locator('.ih-ai-row .ih-ai-text').last().textContent(), /Voltamos ao passo anterior/);
  await click(page, 'Voltar', { stepId: 'android' });
  await click(page, 'Usar iPhone', { stepId: 'escolha', choiceId: 'iphone' });
  await support(page, 'reconectar-canal-qr', 'iphone');
  await page.close();

  const safe = await post({ question: 'Avançar', guide: { guideId: 'reconectar-canal-qr', stepId: 'inicio', version: 2, mode: 'real' } });
  const safePage = await pageWith(safe);
  await support(safePage, 'reconectar-canal-qr', 'inicio');
  await click(safePage, 'Recomeçar', { stepId: 'inicio', resolution: 'in_progress' });
  await safePage.close();
  const safeHumanPage = await pageWith(safe);
  await click(safeHumanPage, 'Falar com uma pessoa', { stepId: 'inicio', resolution: 'partial' });
  await support(safeHumanPage, 'reconectar-canal-qr', 'inicio');
  await safeHumanPage.close();

  const missing = await post({ question: 'Começar', guide: { guideId: 'campanhas', stepId: 'inicio', version: 1, mode: 'real' } });
  const missingPage = await pageWith(missing);
  assert.equal(await missingPage.locator('.ih-ai-row').last().getByRole('button', { name: 'Recomeçar' }).count(), 0, 'guia sem MDX não pode recomeçar');
  assert.ok(await missingPage.locator('.ih-ai-row').last().locator('.ih-ai-sources a').count(), 'guia sem MDX oferece FAQ');
  assert.equal(await missingPage.locator('.ih-ai-row').last().getByRole('button', { name: 'Falar com uma pessoa' }).count(), 0, 'sem MDX o CTA vai direto ao suporte');
  await support(missingPage, 'campanhas');
  await missingPage.close();
  assert.equal(providerCalls, 0, 'jornada inteira sem provider');
  console.log('guide-browser-journey: 3 cenários, cliques reais, payload e provider OK');
} finally {
  await browser?.close();
  site.kill();
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  await rm(root, { recursive: true, force: true });
}
