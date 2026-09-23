import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const queries = [
  ['transferir atendimento', 'Atendimento'],
  ['configurar canal', 'Canais'],
  ['configurações', 'Gerenciamento de Usuários'],
  ['credencial api', 'Obter credencial de integração'],
  ['relatório exportar', 'Relatórios'],
  ['usuário permissão', 'Principais dúvidas'],
  ['mensagem comum api', 'Mensagem comum'],
  ['carteirizar contato', 'Tutoriais guiados'],
  ['como encerrar atendimento', 'Atendimento'],
  ['CSAT', 'Relatórios'],
  ['reabrir atendimento', 'Atendimento'],
  ['áudios anexos', 'Atendimento'],
  ['departamento padrão', 'Canais'],
  ['QR Code canal', 'Canais'],
  ['autotransferência usuário', 'Gerenciamento de Usuários'],
  ['colunas relatório', 'Relatórios'],
  ['token navegador', 'Autenticação'],
  ['Bearer token', 'Autenticação'],
  ['Gupshup créditos', 'Tutoriais guiados'],
  ['pipeline CRM', 'Tutoriais guiados'],
];

// Erros do iframe do Tango (terceiro) não são do nosso site.
const thirdParty = /tango\.us|tango\.ai/i;

function trackErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    const location = message.location()?.url ?? '';
    if (message.type() === 'error' && !thirdParty.test(location) && !thirdParty.test(message.text())) {
      errors.push(`console: ${message.text()} (${location})`);
    }
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(size.content <= size.viewport, `${label}: overflow horizontal ${size.content}px > ${size.viewport}px`);
}

const browser = await chromium.launch({ executablePath, headless: true });

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  const errors = [];
  trackErrors(page, errors);

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Tire sua dúvida sobre o iHelp em uma pergunta.' }).waitFor();
  await assertNoHorizontalOverflow(page, 'home desktop');
  await page.screenshot({ path: '/tmp/ihelp-fumadocs-home-desktop.png', fullPage: true });

  // Atalho ⌘K / Ctrl+K abre a busca.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.locator('#ih-search-dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#ih-search-dialog').waitFor({ state: 'detached' });

  await page.locator('.home-search').click();
  const searchInput = page.locator('[data-search-input]');
  const searchDialog = page.locator('#ih-search-dialog');
  await searchDialog.waitFor();

  for (const [query, expected] of queries) {
    await searchInput.fill(query);
    await assert.doesNotReject(
      searchDialog.getByText(expected, { exact: false }).first().waitFor({ timeout: 3000 }),
      `Busca "${query}" não encontrou "${expected}"`,
    );
  }

  // Enter abre o primeiro resultado.
  await searchInput.fill('transferir atendimento');
  const firstResult = searchDialog.locator('.ih-search-result').first();
  await firstResult.waitFor();
  const firstHref = (await firstResult.getAttribute('href')).split('#')[0].replace(/\/$/, '');
  // O href já inclui o basePath quando existe.
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname.replace(/\/$/, '') === firstHref);
  await searchDialog.waitFor({ state: 'detached' });

  // Chips da home abrem a busca já preenchida.
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.search-suggestions button').first().click();
  assert.match(await page.locator('[data-search-input]').inputValue(), /transferir um atendimento/i);
  await page.keyboard.press('Escape');

  await page.goto(`${baseUrl}/docs/sobre-o-sistema/atendimento/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Atendimento', exact: true }).waitFor();
  assert.equal(await page.locator('video').count(), 1, 'Artigo de Atendimento sem vídeo');
  assert.ok(await page.locator('.ih-sidebar .ih-side-link[data-active]').count(), 'Menu lateral sem item ativo');
  assert.ok(await page.locator('.ih-toc-link').count() > 3, 'Artigo sem índice “Nesta página”');
  await assertNoHorizontalOverflow(page, 'artigo desktop');
  await page.screenshot({ path: '/tmp/ihelp-fumadocs-atendimento.png', fullPage: true });

  await page.goto(`${baseUrl}/docs/principais-duvidas/`, { waitUntil: 'networkidle' });
  const faqItems = page.locator('.ih-faq-item');
  assert.ok(await faqItems.count() >= 5, 'FAQ sem perguntas');
  await page.locator('.ih-faq-filter input').fill('senha');
  assert.equal(await faqItems.count(), 1, 'Filtro do FAQ não filtrou');
  await faqItems.first().locator('button').click();
  await faqItems.first().locator('.ih-faq-answer').waitFor();

  await page.goto(`${baseUrl}/api/atendimentos/buscar-atendimento-por-telefone/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.ih-header-dark').count(), 1, 'API sem cabeçalho escuro');
  assert.match(await page.locator('.ih-url-bar code').textContent(), /customers\/search/);
  assert.ok(await page.locator('.ih-sidebar-api .ih-method[data-method="POST"]').count() > 3, 'Menu da API sem métodos');
  assert.equal(await page.locator('.ih-prose').getByText(':::').count(), 0, 'Aviso Docusaurus sem conversão');

  await page.goto(`${baseUrl}/blog/`, { waitUntil: 'networkidle' });
  assert.ok(await page.locator('.ih-timeline > li').count() >= 6, 'Novidades incompletas');

  await page.goto(`${baseUrl}/tutoriais/`, { waitUntil: 'networkidle' });
  assert.ok(await page.locator('.ih-guide').count() >= 4, 'Lista de tutoriais incompleta');
  await page.locator('.ih-guide').nth(2).click();
  await page.locator('.ih-player-poster').click();
  await page.locator('.ih-player iframe[src*="tango.us"]').waitFor();

  assert.deepEqual(errors, [], `Erros no navegador:\n${errors.join('\n')}`);
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mobilePage = await mobile.newPage();
  const mobileErrors = [];
  trackErrors(mobilePage, mobileErrors);
  await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' });
  await mobilePage.getByRole('heading', { name: 'Tire sua dúvida sobre o iHelp em uma pergunta.' }).waitFor();
  await assertNoHorizontalOverflow(mobilePage, 'home mobile');
  await mobilePage.screenshot({ path: '/tmp/ihelp-fumadocs-home-mobile.png', fullPage: true });

  for (const path of ['/docs/sobre-o-sistema/atendimento/', '/docs/principais-duvidas/', '/api/', '/api/atendimentos/buscar-atendimento-por-telefone/', '/tutoriais/', '/blog/']) {
    await mobilePage.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
    await assertNoHorizontalOverflow(mobilePage, `mobile ${path}`);
  }

  // Menu do celular abre, mostra a navegação e fecha ao navegar.
  await mobilePage.goto(`${baseUrl}/docs/sobre-o-sistema/atendimento/`, { waitUntil: 'networkidle' });
  await mobilePage.locator('.ih-menu-button').click();
  const drawer = mobilePage.locator('.ih-sidebar-wrap[data-open]');
  await drawer.waitFor();
  await drawer.getByRole('link', { name: 'Relatórios', exact: true }).click();
  await mobilePage.waitForURL(/relatorios/);
  await mobilePage.locator('.ih-sidebar-wrap[data-open]').waitFor({ state: 'detached' });
  assert.deepEqual(mobileErrors, [], `Erros no navegador mobile:\n${mobileErrors.join('\n')}`);
  await mobile.close();

  console.log(`UI smoke passou: ${queries.length} buscas, navegação por teclado, artigo, FAQ, API, novidades, Tango e mobile.`);
} finally {
  await browser.close();
}
