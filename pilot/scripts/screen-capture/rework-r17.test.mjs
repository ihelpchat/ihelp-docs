import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePlan, captureScreens } from './capture.mjs';

const sha = 'a'.repeat(40);
const fact = (text, line) => ({ kind: 'action', text, route: '/contact', owner: 'ContactsList', sha,
  source: `src/components/pages/Contacts/ContactsList/index.tsx:${line}` });
const step = (label, name = '01-alvo') => ({ page: 'fixture', step: name, label, role: 'button',
  route: '/contact', action: 'none', alt: label, owner: 'fixture', checkoutSha: sha });

async function fixture(html, plan, options = {}) {
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.url === '/write') { writes++; response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<title>Fixture</title>${html}`);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r17-'));
  try {
    const result = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`,
      root, fixture: true, plan, ...options });
    return { result, writes };
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
}

test('fato anterior do mesmo menu abre Importar contatos sem clicar no item', { timeout: 90000 }, async () => {
  const plan = capturePlan({ page: 'fixture', module: 'Contatos',
    faqBody: '1. Clique em **Importar contatos**.',
    coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }],
    screenFacts: [{ ...fact('Mais opções', 121), kind: 'text', opensMenuFor: 'Importar contatos' }, fact('Importar contatos', 139)] });
  assert.equal(plan[0].menuTrigger, 'Mais opções');
  const { result, writes } = await fixture(`
    <button aria-label="Mais opções" onclick="document.querySelector('#menu').hidden=false">⋮</button>
    <div id="menu" role="menu" hidden><button role="menuitem" onclick="fetch('/write')">Importar contatos</button></div>`, plan,
  { vocabulary: ['Mais opções', 'Importar contatos'] });
  assert.equal(result.steps[0].status, 'capturado', JSON.stringify(result.steps));
  assert.equal(writes, 0);
});

test('sem fato de menu não clica em controles e deixa o item pendente', { timeout: 90000 }, async () => {
  const { result, writes } = await fixture(`
    <button onclick="fetch('/write')">Excluir</button>
    <button aria-label="Mais opções" onclick="document.querySelector('#menu').hidden=false">⋮</button>
    <div id="menu" role="menu" hidden><button role="menuitem" onclick="fetch('/write')">Importar contatos</button></div>`,
  [step('Importar contatos')], { vocabulary: ['Mais opções', 'Importar contatos', 'Excluir'] });
  assert.equal(result.steps[0].status, 'pendente', JSON.stringify(result.steps));
  assert.equal(writes, 0);
});

test('espera skeleton de três segundos terminar antes do print', { timeout: 90000 }, async () => {
  const { result } = await fixture(`
    <button>Adicionar Contato</button><div class="skeleton animate-pulse">Carregando</div>
    <script>setTimeout(() => document.querySelector('.skeleton').remove(), 3000)</script>`,
  [step('Adicionar Contato')], { vocabulary: ['Adicionar Contato'],
    fixtureAfterScreenshot: async (page) => assert.equal(await page.locator('.skeleton').count(), 0) });
  assert.equal(result.steps[0].status, 'capturado', JSON.stringify(result.steps));
  assert.ok(!result.pending?.includes('print com carregamento'));
});

test('espera o ContentLoader SVG de Robôs terminar antes do print', { timeout: 90000 }, async () => {
  const { result } = await fixture(`
    <button>Criar novo robô</button>
    <svg width="400" height="160"><title>Carregando...</title>
      <rect x="0" y="5" width="100" height="20" fill="#f3f3f3"/>
      <rect x="0" y="35" width="100" height="20" fill="#f3f3f3"/>
      <rect x="0" y="65" width="100" height="20" fill="#f3f3f3"/>
      <rect x="0" y="95" width="100" height="20" fill="#f3f3f3"/>
      <rect x="0" y="125" width="100" height="20" fill="#f3f3f3"/>
      <rect x="120" y="5" width="100" height="20" fill="#f3f3f3"/>
    </svg>
    <script>setTimeout(() => document.querySelector('svg').remove(), 3000)</script>`,
  [step('Criar novo robô')], { vocabulary: ['Criar novo robô'],
    fixtureAfterScreenshot: async (page) => assert.equal(await page.locator('svg').count(), 0) });
  assert.equal(result.steps[0].status, 'capturado', JSON.stringify(result.steps));
});

test('loading persistente gera print com pendência explícita', { timeout: 90000 }, async () => {
  const { result } = await fixture('<button>Adicionar Contato</button><div class="skeleton">Carregando</div>',
    [step('Adicionar Contato')], { vocabulary: ['Adicionar Contato'] });
  assert.equal(result.steps[0].status, 'descartado', JSON.stringify(result.steps));
  assert.equal(result.steps[0].motivo, 'print com carregamento');
  assert.ok(result.pending?.includes('print com carregamento: 01-alvo'));
});

test('aba com contador e placeholder do vocabulário não recebe máscara', { timeout: 90000 }, async () => {
  const { result } = await fixture(`
    <button>Criar novo robô</button><nav><a>Lista de Robôs <span>(0)</span></a></nav>`,
  [step('Criar novo robô')], { vocabulary: ['Criar novo robô', 'Lista de Robôs ({count})'] });
  assert.equal(result.steps[0].status, 'capturado', JSON.stringify(result.steps));
  assert.ok(!result.entries[0].masked.includes('texto não confirmado'), JSON.stringify(result.entries[0].masked));
});

test('placeholder de contador não libera texto desconhecido na aba', { timeout: 90000 }, async () => {
  const { result } = await fixture(`
    <button>Criar novo robô</button><nav><a>Lista de Robôs <span>Nome privado</span></a></nav>`,
  [step('Criar novo robô')], { vocabulary: ['Criar novo robô', 'Lista de Robôs ({count})'] });
  assert.equal(result.steps[0].status, 'capturado', JSON.stringify(result.steps));
  assert.ok(result.entries[0].masked.includes('texto não confirmado'));
});
