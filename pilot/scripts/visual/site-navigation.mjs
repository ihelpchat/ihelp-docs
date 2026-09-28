import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launch } from './measure.mjs';

const reference = JSON.parse(await readFile(new URL('./navigation-reference.json', import.meta.url), 'utf8'));
assert.match(reference.measuredAt, /^\d{4}-\d{2}-\d{2}$/, 'referência sem data de medição');
const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, 'BASE_URL necessário para o teste visual');
const browser = await launch();
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
    const page = await browser.newPage({ viewport });
    try {
      await page.goto(`${baseUrl}/docs/sobre-o-sistema/agenda-de-contatos/`, { waitUntil: 'networkidle' });
      if (process.env.NAVIGATION_PROBE_CSS) await page.addStyleTag({ content: process.env.NAVIGATION_PROBE_CSS });
      if (name === 'mobile') await page.locator('.ih-menu-button').click();
      await page.screenshot({ path: `/tmp/m5-65-agenda-${name}.png`, fullPage: true });
      const metrics = await page.evaluate(() => {
        const read = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { font: parseFloat(getComputedStyle(element).fontSize), width: box.width, height: box.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight), text: element.textContent.trim(), scrollWidth: element.scrollWidth };
        };
        return Object.fromEntries(Object.entries({
          section: '.ih-side-kicker', side: '.ih-side-label', breadcrumb: '.ih-breadcrumb',
          toc: '.ih-toc-link', tocTitle: '.ih-toc-kicker', meta: '.ih-meta',
          body: '.ih-prose', search: '.ih-header-search', searchText: '.ih-header-search span',
          nav: '.ih-nav-link[href*="/assistente"]', launcher: '.ih-ai-launcher', menu: '.ih-menu-button',
          support: '.ih-header-cta', ask: '.ih-toc-ask', feedback: '.ih-feedback .ih-button',
          product: '.ih-product-action small', sideLink: '.ih-side-link', sideGroup: '.ih-side-group-toggle',
        }).map(([key, selector]) => [key, read(selector)]));
      });
      assert.ok(metrics.section && metrics.section.height <= metrics.section.lineHeight + 1, `${name}: rótulo da seção quebrou linha`);
      for (const [key, production] of Object.entries(reference.fontPx)) {
        if (name === 'mobile' && key.startsWith('toc')) continue;
        const min = Math.max(12, production - 1);
        const max = production + 1;
        assert.ok(metrics[key]?.font >= min && metrics[key]?.font <= max,
          `${name}: ${key} ${metrics[key]?.font}px fora de ${min}–${max}px (produção ${production}px)`);
      }
      assert.ok(metrics.body?.font >= 16, `${name}: corpo ${metrics.body?.font}px < 16px`);
      assert.ok(metrics.search?.width >= (name === 'desktop' ? 150 : 36), `${name}: busca não visível`);
      if (name === 'desktop') {
        assert.ok(metrics.searchText?.width > 70, 'desktop: texto da busca oculto');
        assert.ok(metrics.searchText?.width >= metrics.searchText?.scrollWidth,
          `desktop: placeholder cortado (${metrics.searchText?.width}px < ${metrics.searchText?.scrollWidth}px)`);
        for (const [key, production] of Object.entries(reference.desktop1440.fontPx)) {
          assert.ok(metrics[key]?.font >= production - 1 && metrics[key]?.font <= production + 1,
            `desktop: ${key} ${metrics[key]?.font}px fora da escala de produção ${production}px`);
        }
        assert.ok(metrics.sideLink?.height <= reference.desktop1440.sideLinkHeight + 4, 'desktop: item do menu alto demais');
        assert.ok(metrics.sideGroup?.height <= reference.desktop1440.sideGroupHeight + 4, 'desktop: grupo do menu alto demais');
        const tocSingleLine = await page.locator('.ih-toc-link').evaluateAll((links) => Math.min(...links.filter((link) => link.textContent.trim().length <= 32).map((link) => link.getBoundingClientRect().height)));
        assert.ok(Number.isFinite(tocSingleLine) && tocSingleLine <= reference.desktop1440.tocSingleLineHeight + 4,
          `desktop: item do índice alto demais (${tocSingleLine}px)`);
        assert.equal(metrics.nav?.text, 'Claricia', 'desktop: rótulo curto no topo');
      } else {
        assert.ok(metrics.menu?.height >= 44, 'mobile: menu abaixo de 44px');
        assert.ok(metrics.sideLink?.height >= 44 && metrics.sideGroup?.height >= 44, 'mobile: menu abaixo de 44px');
        assert.ok(metrics.feedback?.height >= 44, 'mobile: feedback abaixo de 44px');
      }
      assert.ok(metrics.search?.height >= 44, `${name}: busca abaixo de 44px`);
      assert.match(metrics.launcher?.text ?? '', /^Claricia.*assistente virtual$/, `${name}: subtítulo ausente no botão flutuante`);
      assert.ok(metrics.launcher?.height >= 44, `${name}: botão flutuante abaixo de 44px`);
    } finally { await page.close(); }
  }
  console.log('Navegação visual: Agenda de Contatos desktop 1440 e mobile 390 passou.');
} finally { await browser.close(); }
