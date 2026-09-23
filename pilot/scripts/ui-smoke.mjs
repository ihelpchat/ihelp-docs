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


// Resposta simulada do serviço de IA (só no teste): o site nunca inventa resposta.
const mockReply = {
  answer: 'Abra a conversa e use a opção Transferir no painel do contato.\n\nO histórico vai junto.',
  sections: [{ title: 'Antes de começar', items: ['Confirme o departamento de destino.'] }],
  steps: ['Abra a conversa.', 'Clique em Transferir.', 'Escolha o destino e confirme.'],
  code: { language: 'bash', content: 'curl -H "Authorization: Bearer $IHELP_TOKEN" https://apiv3.ihelpchat.com/api/v2/customers/search' },
  sources: [{ title: 'Atendimento', path: '/docs/sobre-o-sistema/atendimento', excerpt: 'Iniciar, transferir, encerrar e reabrir atendimentos.' }],
  suggestions: ['Como reabrir um atendimento finalizado?'],
  resolution: 'partial',
  found: true,
};

async function mockAssistant(page, { fail = 0 } = {}) {
  const requests = [];
  let failures = fail;
  await page.route('**/assistant', async (route) => {
    requests.push(route.request().postDataJSON());
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (failures > 0) {
      failures -= 1;
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'indisponível' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockReply) });
  });
  await page.route('**/feedback', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ saved: true, id: 'ui-smoke' }) }));
  return requests;
}

async function testAssistant(context, errors) {
  const page = await context.newPage();
  trackErrors(page, errors);
  // O erro 502 simulado aparece no console do navegador; não é falha do site.
  page.on('console', () => {});
  const requests = await mockAssistant(page, { fail: 1 });
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  const enabled = (await page.locator('.ih-app').getAttribute('data-assistant')) === 'on';

  // Entrada pelo menu do topo, sem depender de ⌘K.
  await page.getByRole('link', { name: 'Assistente de IA' }).first().click();
  await page.waitForURL(/\/assistente\/?$/);
  await page.getByRole('heading', { name: 'Pergunte qualquer coisa sobre o iHelp' }).waitFor();
  assert.equal(await page.locator('.ih-ai-starters button').count(), 4, 'Sugestões iniciais ausentes');
  assert.equal(await page.locator('.ih-ai-launcher').count(), 0, 'Botão flutuante não deve aparecer na tela do assistente');

  if (!enabled) {
    await page.locator('.ih-ai-starters button').first().click();
    await page.getByText('Assistente não conectado').waitFor();
    assert.equal(requests.length, 0, 'Sem endpoint configurado, nada deve ser enviado');
    await page.close();
    return;
  }

  // 1ª tentativa falha → estado de erro → “Tentar de novo” responde.
  await page.locator('.ih-ai-starters button').first().click();
  await page.locator('.ih-ai-busy').waitFor();
  await page.locator('.ih-ai-error').waitFor();
  errors.splice(0, errors.length, ...errors.filter((item) => !/502|Failed to load resource/.test(item)));
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await page.locator('.ih-ai-steps li').first().waitFor();
  assert.equal(await page.locator('.ih-ai-sections section').count(), 1);
  const supportCta = page.getByRole('link', { name: 'Falar com o atendimento' }).last();
  assert.match(await supportCta.getAttribute('href'), /wa\.me\/551730422307\?text=/);
  assert.ok(await page.getByText('Abrir artigo').count(), 'Fonte sem ação explícita para abrir o artigo');
  assert.equal(await page.locator('.ih-ai-error').count(), 0, 'Erro deveria sumir após tentar de novo');
  assert.equal(await page.locator('.ih-ai-steps li').count(), 3);
  assert.equal(await page.locator('.ih-ai-code pre').count(), 1);
  assert.equal(await page.locator('.ih-ai-panel-list li').count(), 1, 'Painel de fontes vazio');
  assert.equal(requests.at(-1).scope, 'Tudo');

  // Escopo “Buscar em” vai no pedido; sugestão de continuação pergunta de novo, com histórico.
  await page.getByRole('button', { name: 'API', exact: true }).click();
  await page.locator('.ih-ai-follow button').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.ih-ai-steps').length === 2);
  assert.equal(requests.at(-1).scope, 'API');
  assert.ok(requests.at(-1).history.length >= 2, 'Histórico não foi enviado');
  await page.getByRole('button', { name: 'Resposta útil' }).last().click();
  await page.getByText('Obrigado pelo retorno').waitFor();

  // Composer: Enter envia, Shift+Enter quebra linha.
  const composer = page.getByRole('textbox', { name: 'Pergunta para o assistente' });
  await composer.fill('Linha 1');
  await composer.press('Shift+Enter');
  assert.match(await composer.inputValue(), /Linha 1\n/);
  await composer.fill('');
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await page.getByRole('heading', { name: 'Pergunte qualquer coisa sobre o iHelp' }).waitFor();

  // Painel lateral numa página: contexto da página vai junto; Esc fecha; tela cheia leva a conversa.
  await page.goto(`${baseUrl}/docs/sobre-o-sistema/atendimento/`, { waitUntil: 'networkidle' });
  await page.locator('.ih-ai-launcher').click();
  const drawer = page.getByRole('dialog', { name: 'Assistente de IA' });
  await drawer.waitFor();
  assert.match(await drawer.locator('.ih-ai-drawer-context strong').textContent(), /Central de ajuda › Atendimento/);
  await drawer.locator('.ih-ai-drawer-empty button').first().click();
  await drawer.locator('.ih-ai-steps').waitFor();
  assert.equal(requests.at(-1).page.path, '/docs/sobre-o-sistema/atendimento');
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  await page.locator('.ih-ai-launcher-dot').waitFor();
  await page.locator('.ih-ai-launcher').click();
  await drawer.getByRole('button', { name: 'Abrir em tela cheia' }).click();
  await page.waitForURL(/\/assistente\/?$/);
  assert.ok(await page.locator('.ih-ai-user').count() >= 1, 'Conversa não foi para a tela cheia');

  // Busca: Enter numa página abre o painel e pergunta.
  await page.goto(`${baseUrl}/api/`, { waitUntil: 'networkidle' });
  await page.locator('.ih-header-search').click();
  await page.locator('[data-search-input]').fill('Como autenticar na API');
  await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: 'Assistente de IA' }).waitFor();
  await page.locator('.ih-ai-drawer .ih-ai-user').last().getByText('Como autenticar na API').waitFor();
  await page.close();
}

async function testNavigation(page) {
  // Menu lateral recolhível, pelo mouse e pelo teclado.
  await page.goto(`${baseUrl}/docs/sobre-o-sistema/atendimento/`, { waitUntil: 'networkidle' });
  const toggles = page.locator('.ih-sidebar .ih-side-group-toggle');
  const whatsapp = toggles.filter({ hasText: 'WhatsApp Business API' });
  assert.equal(await whatsapp.getAttribute('aria-expanded'), 'false', 'Grupo sem página ativa deveria começar recolhido');
  await whatsapp.focus();
  await page.keyboard.press('Enter');
  assert.equal(await whatsapp.getAttribute('aria-expanded'), 'true');
  const list = page.locator(`#${await whatsapp.getAttribute('aria-controls')}`);
  assert.ok(await list.isVisible(), 'Lista do grupo não abriu');
  await page.getByRole('button', { name: 'Recolher tudo' }).first().click();
  assert.equal(await page.locator('.ih-sidebar .ih-side-group-toggle[aria-expanded="true"]').count(), 0);
  await page.getByRole('button', { name: 'Expandir tudo' }).first().click();
  assert.equal(await page.locator('.ih-sidebar .ih-side-group-toggle[aria-expanded="false"]').count(), 0);

  // Menu da API também recolhe.
  await page.goto(`${baseUrl}/api/`, { waitUntil: 'networkidle' });
  const apiGroup = page.locator('.ih-sidebar-api .ih-side-group-toggle').filter({ hasText: 'Atendimentos' });
  assert.equal(await apiGroup.getAttribute('aria-expanded'), 'false');
  await apiGroup.click();
  assert.equal(await apiGroup.getAttribute('aria-expanded'), 'true');

  // Índice “Nesta página” some quando a página não tem títulos.
  await page.goto(`${baseUrl}/api/conceitos/obter-token/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.ih-toc').count(), 0, 'Índice vazio deveria estar oculto');

  // Tutoriais: filtro dos módulos e estado vazio.
  await page.goto(`${baseUrl}/tutoriais/`, { waitUntil: 'networkidle' });
  const filter = page.getByRole('textbox', { name: 'Filtrar guias' });
  await filter.fill('pipeline');
  assert.equal(await page.locator('.ih-tut-aside .ih-side-group').count(), 1);
  await filter.fill('xyz-sem-guia');
  await page.getByText('Nenhum guia encontrado.').waitFor();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  assert.ok(await page.locator('.ih-tut-aside .ih-side-group').count() >= 3);
  await page.locator('.ih-tut-aside .ih-side-group-toggle').filter({ hasText: 'CRM' }).click();
  await page.locator('.ih-tut-aside .ih-side-link').filter({ hasText: 'Pipeline' }).click();
  assert.match(await page.locator('.ih-player h2').textContent(), /Pipeline/);
  assert.match(await page.locator('.ih-guide-column .ih-eyebrow').textContent(), /Guias de CRM/);
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

  await page.locator('.ih-header-search').click();
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

  // Teste opcional contra o serviço de IA de verdade (precisa da chave no servidor).
  if (process.env.ASSISTANT_TEST === '1') {
    const live = await browser.newPage();
    await live.goto(`${baseUrl}/assistente/`, { waitUntil: 'networkidle' });
    await live.getByRole('textbox', { name: 'Pergunta para o assistente' }).fill('Como transfiro um atendimento para outro departamento?');
    await live.keyboard.press('Enter');
    const answer = live.locator('.ih-ai-row').filter({ has: live.locator('.ih-ai-text') }).last();
    await answer.waitFor({ timeout: 30_000 });
    assert.match(await answer.textContent(), /transferir|transferência/i, 'Assistente GPT não respondeu com o contexto esperado');
    assert.ok(await answer.locator('.ih-ai-sources a').count(), 'Assistente GPT respondeu sem fonte');
    await live.close();
  }

  // Enter abre o primeiro resultado.
  await searchInput.fill('transferir atendimento');
  const firstResult = searchDialog.locator('.ih-search-result').first();
  await firstResult.waitFor();
  // Com a IA ligada, Enter pergunta; depois de navegar pelas setas, Enter abre o resultado.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  const firstHref = (await firstResult.getAttribute('href')).split('#')[0].replace(/\/$/, '');
  // O href já inclui o basePath quando existe.
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname.replace(/\/$/, '') === firstHref);
  await searchDialog.waitFor({ state: 'detached' });

  // Chips da home: com IA, perguntam na tela do assistente; sem IA, abrem a busca preenchida.
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if ((await page.locator('.ih-app').getAttribute('data-assistant')) === 'on') {
    await page.route('**/assistant', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockReply) }));
    await page.locator('.search-suggestions button').first().click();
    await page.waitForURL(/\/assistente\/?$/);
    await page.locator('.ih-ai-user').getByText('Como reconectar meu WhatsApp?').waitFor();
    await page.getByRole('button', { name: 'Nova conversa' }).click();
    await page.unroute('**/assistant');
  } else {
    await page.locator('.search-suggestions button').first().click();
    assert.match(await page.locator('[data-search-input]').inputValue(), /transferir um atendimento/i);
    await page.keyboard.press('Escape');
  }

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
  assert.ok(await page.locator('.ih-tut-aside .ih-side-link').count() >= 4, 'Lista de tutoriais incompleta');
  await page.locator('.ih-guide').last().click();
  const tangoLink = page.locator('.ih-player-poster');
  assert.match(await tangoLink.getAttribute('href'), /tango\.us\/app\/workflow/);
  assert.equal(await page.locator('.ih-player iframe').count(), 0, 'Tutorial não deve carregar embed privado');

  await testNavigation(page);
  await testAssistant(desktop, errors);

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

  for (const path of ['/docs/sobre-o-sistema/atendimento/', '/docs/principais-duvidas/', '/api/', '/api/atendimentos/buscar-atendimento-por-telefone/', '/tutoriais/', '/blog/', '/assistente/']) {
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
  // Painel do assistente cabe na tela do celular.
  await mobilePage.goto(`${baseUrl}/docs/sobre-o-sistema/atendimento/`, { waitUntil: 'networkidle' });
  await mobilePage.locator('.ih-ai-launcher').click();
  await mobilePage.locator('.ih-ai-drawer').waitFor();
  await mobilePage.waitForTimeout(350); // fim da animação de entrada
  const mobileDrawer = await mobilePage.locator('.ih-ai-drawer').boundingBox();
  assert.ok(mobileDrawer && mobileDrawer.x >= 0 && mobileDrawer.x + mobileDrawer.width <= 390, 'Painel do assistente sai da tela no celular');
  await assertNoHorizontalOverflow(mobilePage, 'mobile painel do assistente');
  assert.deepEqual(mobileErrors, [], `Erros no navegador mobile:\n${mobileErrors.join('\n')}`);
  await mobile.close();

  console.log(`UI smoke passou: ${queries.length} buscas, navegação por teclado, assistente (estados e painel), menus recolhíveis, artigo, FAQ, API, novidades, Tango e mobile.`);
} finally {
  await browser.close();
}
