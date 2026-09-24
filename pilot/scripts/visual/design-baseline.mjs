/**
 * Gera `fixtures/design-baseline.json` a partir do protótipo do Claude Design.
 *
 * O protótipo não é versionado. Para atualizar a referência:
 * 1. Pelo MCP `claude-design`, baixe `Documentação ihelp.dc.html` e os arquivos que ele usa
 *    (support.js, _ds/, assets/) para uma pasta temporária FORA do repositório e sirva essa pasta.
 * 2. Rode `DESIGN_URL=http://127.0.0.1:4190/index.html npm run qa:visual:baseline`.
 * Só medidas (posição, tamanho, estilos e uma grade grosseira de cores) vão para o JSON.
 */
import { writeFile } from 'node:fs/promises';
import { checksFor, colorGrid, gridBlock, launch, measureInPage, openDesignScreen, screens } from './measure.mjs';

const designUrl = process.env.DESIGN_URL;
if (!designUrl) throw new Error('Defina DESIGN_URL apontando para o protótipo servido localmente.');
if (/[?&]t=/.test(designUrl)) throw new Error('Não use a URL assinada do Claude Design; sirva uma cópia local.');

const baseline = {
  source: {
    project: 'https://claude.ai/design/p/a4e927da-6ccb-4992-bd0a-d3abb0ab65f4',
    file: 'Documentação ihelp.dc.html',
    etag: process.env.DESIGN_ETAG ?? null,
    capturedAt: new Date().toISOString(),
  },
  screens: {},
};

const browser = await launch();
try {
  for (const screen of screens) {
    for (const viewport of screen.viewports) {
      const page = await openDesignScreen(browser, designUrl, screen, viewport);
      const checks = {};
      for (const check of checksFor(screen, viewport)) {
        const measured = await page.evaluate(`(${measureInPage.toString()})(${check.design})`);
        if (!measured) throw new Error(`Protótipo: ponto ${screen.name}/${viewport}/${check.id} não encontrado`);
        checks[check.id] = Object.fromEntries(check.props.map((prop) => [prop, measured[prop]]));
      }
      const grid = await colorGrid(page, gridBlock[viewport]);
      baseline.screens[`${screen.name}:${viewport}`] = { checks, grid };
      await page.close();
      console.log(`ok ${screen.name}/${viewport}: ${Object.keys(checks).length} pontos`);
    }
  }
} finally {
  await browser.close();
}

const target = new URL('../fixtures/design-baseline.json', import.meta.url);
await writeFile(target, `${JSON.stringify(baseline, null, 1)}\n`);
console.log(`Referência gravada em ${target.pathname}`);
