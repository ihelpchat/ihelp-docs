import assert from 'node:assert/strict';
import { launch } from './measure.mjs';

const baseUrl = process.env.BASE_URL;
assert.ok(baseUrl, 'BASE_URL necessário para o teste visual');
const browser = await launch();
try {
  for (const [name, viewport] of Object.entries({ desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } })) {
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
          return { font: parseFloat(getComputedStyle(element).fontSize), width: box.width, height: box.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight), text: element.textContent.trim() };
        };
        return Object.fromEntries(Object.entries({
          section: '.ih-side-kicker', side: '.ih-side-label', breadcrumb: '.ih-breadcrumb',
          toc: '.ih-toc-link', tocTitle: '.ih-toc-kicker', meta: '.ih-meta',
          body: '.ih-prose', search: '.ih-header-search', searchText: '.ih-header-search span',
          nav: '.ih-nav-link[href*="/assistente"]', launcher: '.ih-ai-launcher', menu: '.ih-menu-button',
        }).map(([key, selector]) => [key, read(selector)]));
      });
      assert.ok(metrics.section && metrics.section.height <= metrics.section.lineHeight + 1, `${name}: rótulo da seção quebrou linha`);
      for (const [key, max] of Object.entries({ section: 11, side: 13, breadcrumb: 12, meta: 12, tocTitle: 11, toc: 12 })) {
        if (name === 'mobile' && key.startsWith('toc')) continue;
        assert.ok(metrics[key]?.font <= max, `${name}: ${key} ${metrics[key]?.font}px > ${max}px da produção`);
      }
      assert.ok(metrics.body?.font >= 16, `${name}: corpo ${metrics.body?.font}px < 16px`);
      assert.ok(metrics.search?.width >= (name === 'desktop' ? 150 : 36), `${name}: busca não visível`);
      if (name === 'desktop') {
        assert.ok(metrics.searchText?.width > 70, 'desktop: texto da busca oculto');
        assert.equal(metrics.nav?.text, 'Claricia', 'desktop: rótulo curto no topo');
      } else {
        assert.ok(metrics.menu?.height >= 44, 'mobile: menu abaixo de 44px');
      }
      assert.ok(metrics.search?.height >= 44, `${name}: busca abaixo de 44px`);
      assert.match(metrics.launcher?.text ?? '', /^Claricia.*assistente virtual$/, `${name}: subtítulo ausente no botão flutuante`);
      assert.ok(metrics.launcher?.height >= 44, `${name}: botão flutuante abaixo de 44px`);
    } finally { await page.close(); }
  }
  console.log('Navegação visual: Agenda de Contatos desktop 1280 e mobile 390 passou.');
} finally { await browser.close(); }
