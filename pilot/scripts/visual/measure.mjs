import { chromium } from 'playwright-core';
import { designHelpers, screens, viewports } from './probes.mjs';

export const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Tamanho do bloco da grade de cor, em px CSS. */
export const gridBlock = { desktop: 40, mobile: 26 };

export async function launch() {
  return chromium.launch({ executablePath, headless: true });
}

/** Mede um elemento: posição, tamanho e estilos computados relevantes. */
export function measureInPage(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const color = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [red, green, blue, alpha = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
    return [Number(red), Number(green), Number(blue), Number(alpha)];
  };
  return {
    left: r.left + window.scrollX,
    top: r.top + window.scrollY,
    right: r.right + window.scrollX,
    width: r.width,
    height: r.height,
    fontSize: parseFloat(s.fontSize),
    fontWeight: Number(s.fontWeight),
    lineHeight: parseFloat(s.lineHeight) || null,
    borderRadius: parseFloat(s.borderTopLeftRadius) || 0,
    color: color(s.color),
    background: color(s.backgroundColor),
    borderColor: color(s.borderTopColor),
  };
}

/** Grade de cores médias do que está visível na tela (sem rolar). */
export async function colorGrid(page, block) {
  const shot = await page.screenshot({ type: 'png' });
  return page.evaluate(async ({ data, block }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const scale = img.width / window.innerWidth;
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const cols = Math.floor(window.innerWidth / block);
    const rows = Math.floor(window.innerHeight / block);
    const size = Math.round(block * scale);
    let hex = '';
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const { data: px } = ctx.getImageData(x * size, y * size, size, size);
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let i = 0; i < px.length; i += 4) {
          red += px[i];
          green += px[i + 1];
          blue += px[i + 2];
        }
        const n = px.length / 4;
        hex += [red, green, blue].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
      }
    }
    return { cols, rows, hex };
  }, { data: shot.toString('base64'), block });
}

/** Abre a tela do protótipo (SPA) e executa os cliques de navegação. */
export async function openDesignScreen(browser, designUrl, screen, viewportName) {
  const page = await browser.newPage({ viewport: viewports[viewportName] });
  await page.goto(designUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(designHelpers);
  for (const step of screen.design) {
    const clicked = await page.evaluate((text) => {
      const el = window.__byText(text);
      if (!el) return false;
      el.click();
      return true;
    }, step.click);
    if (!clicked) throw new Error(`Protótipo: não achei "${step.click}" em ${screen.name}`);
    await page.waitForTimeout(350);
  }
  if (screen.designHide) {
    await page.evaluate((text) => {
      const bar = window.__up(window.__byText(text), (r) => r.width > 600);
      if (bar) bar.style.display = 'none';
    }, screen.designHide);
  }
  // O protótipo rola dentro de um contêiner próprio; zeramos a rolagem para medir a partir do topo.
  await page.evaluate(() => document.querySelectorAll('.ih-scroll').forEach((node) => { node.scrollTop = 0; }));
  await page.waitForTimeout(250);
  return page;
}

export async function openAppScreen(browser, baseUrl, screen, viewportName) {
  const page = await browser.newPage({ viewport: viewports[viewportName] });
  await page.goto(`${baseUrl}${screen.app}`, { waitUntil: 'networkidle' });
  if (screen.appOpenSearch) {
    await page.locator('.ih-header-search').click();
    await page.locator('.ih-search').waitFor();
  }
  await page.waitForTimeout(350);
  return page;
}

export function screenViewports(screen) {
  return screen.viewports;
}

export function checksFor(screen, viewportName) {
  return screen.checks.filter((check) => !check.only || check.only === viewportName);
}

export { screens, viewports };
