/**
 * Compara o app com o protótipo do Claude Design (projeto “Estrutura de docs ihelp”).
 *
 * Duas medidas, por viewport (desktop 1440×1000 e mobile 390×844):
 * - pontos de controle: posição, tamanho e estilo de ~90 elementos, contra `fixtures/design-baseline.json`;
 * - grade de cor: a tela visível dividida em blocos, comparando a cor média de cada bloco.
 *
 * No mobile, as telas internas do protótipo não se adaptam (a barra lateral fixa empurra o conteúdo
 * para fora da tela), então ali comparamos só tipografia e cores; posição e grade de cor valem para a home.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { checksFor, colorGrid, gridBlock, launch, measureInPage, openAppScreen, screens } from './visual/measure.mjs';
import { accessibleColors, tolerance } from './visual/probes.mjs';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const minimum = Number(process.env.VISUAL_MIN ?? 90);
const reportDir = process.env.VISUAL_REPORT_DIR;
const baseline = JSON.parse(await readFile(new URL('./fixtures/design-baseline.json', import.meta.url), 'utf8'));

const styleProps = new Set(['fontSize', 'fontWeight', 'lineHeight', 'color', 'background', 'borderColor', 'borderRadius']);

function colorDistance(a, b) {
  if (!a || !b) return a === b ? 0 : Infinity;
  // Fundo transparente conta como igual ao fundo da página.
  const flatten = (c) => (c[3] === 0 ? [248, 250, 252] : c.slice(0, 3).map((v) => Math.round(v * c[3] + 248 * (1 - c[3]))));
  const [x, y] = [flatten(a), flatten(b)];
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])));
}

function compare(prop, expected, actual) {
  if (actual === undefined || actual === null) return { pass: false, delta: 'ausente' };
  if (['color', 'background', 'borderColor'].includes(prop)) {
    const delta = colorDistance(expected, actual);
    if (delta <= tolerance.color) return { pass: true, delta };
    const swap = accessibleColors.find((item) => colorDistance([...item.design, 1], expected) <= 2 && colorDistance([...item.app, 1], actual) <= 2);
    return swap ? { pass: true, delta, a11y: swap.motivo } : { pass: false, delta };
  }
  if (prop === 'fontWeight') return { pass: Math.abs(expected - actual) < 100, delta: actual - expected };
  const delta = Math.round((actual - expected) * 10) / 10;
  return { pass: Math.abs(delta) <= (tolerance[prop] ?? 8), delta };
}

function gridSimilarity(expected, actual) {
  const blocks = Math.min(expected.hex.length, actual.hex.length) / 6;
  let same = 0;
  for (let i = 0; i < blocks; i += 1) {
    const a = expected.hex.slice(i * 6, i * 6 + 6).match(/../g).map((h) => parseInt(h, 16));
    const b = actual.hex.slice(i * 6, i * 6 + 6).match(/../g).map((h) => parseInt(h, 16));
    if (Math.max(...a.map((v, j) => Math.abs(v - b[j]))) <= 24) same += 1;
  }
  return Math.round((same / blocks) * 1000) / 10;
}

const results = { desktop: [], mobile: [] };
const grids = { desktop: [], mobile: [] };
const failures = [];
const a11ySwaps = [];

const browser = await launch();
try {
  for (const screen of screens) {
    for (const viewport of screen.viewports) {
      const key = `${screen.name}:${viewport}`;
      const reference = baseline.screens[key];
      assert.ok(reference, `Sem referência para ${key}; rode qa:visual:baseline`);
      const page = await openAppScreen(browser, baseUrl, screen, viewport);
      const layoutComparable = viewport === 'desktop' || screen.name === 'home';

      for (const check of checksFor(screen, viewport)) {
        const measured = await page.evaluate(
          ({ selector, fn }) => new Function('el', `return (${fn})(el)`)(document.querySelector(selector)),
          { selector: check.app, fn: measureInPage.toString() },
        );
        for (const prop of check.props) {
          if (!layoutComparable && !styleProps.has(prop) && !(check.id === 'header' && prop === 'height')) continue;
          const expected = reference.checks[check.id]?.[prop];
          const outcome = measured ? compare(prop, expected, measured[prop]) : { pass: false, delta: 'elemento ausente' };
          results[viewport].push(outcome.pass);
          if (outcome.a11y) a11ySwaps.push(`${key} ${check.id}.${prop}: ${outcome.a11y}`);
          if (!outcome.pass) failures.push({ tela: key, ponto: check.id, medida: prop, esperado: expected, obtido: measured?.[prop], diferenca: outcome.delta });
        }
      }

      if (layoutComparable && screen.grid !== false) {
        const grid = await colorGrid(page, gridBlock[viewport]);
        const similarity = gridSimilarity(reference.grid, grid);
        grids[viewport].push({ tela: screen.name, similaridade: similarity });
      }
      if (reportDir) {
        await mkdir(reportDir, { recursive: true });
        await page.screenshot({ path: `${reportDir}/${screen.name}-${viewport}.png` });
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}

const summary = {};
for (const viewport of ['desktop', 'mobile']) {
  const passed = results[viewport].filter(Boolean).length;
  const points = Math.round((passed / results[viewport].length) * 1000) / 10;
  const gridAverage = Math.round((grids[viewport].reduce((sum, item) => sum + item.similaridade, 0) / grids[viewport].length) * 10) / 10;
  summary[viewport] = { pontos: `${points}% (${passed}/${results[viewport].length})`, pontosPct: points, gradeMedia: gridAverage, grade: grids[viewport] };
}

for (const failure of failures) console.error('DIFERENTE', JSON.stringify(failure));
for (const swap of a11ySwaps) console.log('ACESSIBILIDADE', swap);
for (const [viewport, item] of Object.entries(summary)) {
  console.log(`${viewport}: pontos de controle ${item.pontos}; grade de cor média ${item.gradeMedia}% (${item.grade.map((g) => `${g.tela} ${g.similaridade}%`).join(', ')})`);
}
if (reportDir) await writeFile(`${reportDir}/visual-summary.json`, JSON.stringify({ summary, failures, a11ySwaps }, null, 2));

for (const [viewport, item] of Object.entries(summary)) {
  assert.ok(item.pontosPct >= minimum, `${viewport}: pontos de controle abaixo de ${minimum}% (${item.pontos})`);
  assert.ok(item.gradeMedia >= minimum, `${viewport}: grade de cor abaixo de ${minimum}% (${item.gradeMedia}%)`);
}
console.log(`Fidelidade visual aprovada: mínimo de ${minimum}% em desktop e mobile.`);
