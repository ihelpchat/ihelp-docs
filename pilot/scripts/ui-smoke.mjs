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
  ['carteirizar contato', 'Tutoriais Guiados'],
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
  ['Gupshup créditos', 'Tutoriais Guiados'],
  ['pipeline CRM', 'Tutoriais Guiados'],
];

function trackErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
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

  await page.locator('.home-search').click();
  const searchInput = page.locator('[data-fd-search-dialog-input]');
  const searchDialog = page.locator('#fd-search-dialog-content');

  for (const [query, expected] of queries) {
    await searchInput.fill(query);
    await assert.doesNotReject(
      searchDialog.getByText(expected, { exact: false }).first().waitFor({ timeout: 3000 }),
      `Busca "${query}" não encontrou "${expected}"`,
    );
  }

  await page.keyboard.press('Escape');
  await page.goto(`${baseUrl}/docs/sobre-o-sistema/atendimento/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Atendimento', exact: true }).waitFor();
  assert.equal(await page.locator('video').count(), 1, 'Artigo de Atendimento sem vídeo');
  await assertNoHorizontalOverflow(page, 'artigo desktop');
  await page.screenshot({ path: '/tmp/ihelp-fumadocs-atendimento.png', fullPage: true });

  await page.goto(`${baseUrl}/tutoriais/`, { waitUntil: 'networkidle' });
  const openTutorial = page.getByRole('button', { name: /Ver passo a passo/ }).first();
  await openTutorial.evaluate((element) => element.click());
  const tutorialDialog = page.locator('dialog.tutorial-dialog[open]');
  await tutorialDialog.waitFor();
  await tutorialDialog.locator('iframe[src*="tango.us"]').waitFor();
  await tutorialDialog.getByRole('button', { name: 'Fechar tutorial' }).click();

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
  assert.deepEqual(mobileErrors, [], `Erros no navegador mobile:\n${mobileErrors.join('\n')}`);
  await mobile.close();

  console.log(`UI smoke passou: ${queries.length} buscas, desktop, artigo, Tango e mobile.`);
} finally {
  await browser.close();
}
