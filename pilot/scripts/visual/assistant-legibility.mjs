import assert from 'node:assert/strict';
import { launch } from './measure.mjs';
import { viewports } from './probes.mjs';
import { startQaSite } from './serve-qa-build.mjs';

const out = new URL('../../out/', import.meta.url).pathname;
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/ihelp-docs';
const reply = (extra = {}) => ({ answer: 'Abra Configurações e confira o canal.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true, actions: [], ...extra });
const question = { id: 'q1', role: 'user', text: 'Como reconectar o WhatsApp?' };
const states = {
  normal: [{ ...question }, { id: 'a1', role: 'ai', question: question.text, reply: reply({ sources: [{ title: 'Reconectar o WhatsApp', path: '/docs/whatsapp', kind: 'Ajuda', excerpt: 'Confira o canal.' }], suggestions: ['Achei', 'Não achei'] }) }],
  guia: [{ ...question }, { id: 'a1', role: 'ai', question: question.text, reply: reply({ answer: 'Vamos fazer juntos. Primeiro, abra Configurações.', steps: [{ text: 'Abra Configurações e escolha Canais.', action: { id: 'open-channels', label: 'Abrir Canais', route: '/configuracoes/canais' } }, { text: 'Confira o código na tela.' }], suggestions: ['Achei'] }) }],
  fallback: [{ ...question }, { id: 'a1', role: 'ai', question: question.text, reply: reply({ answer: 'O assistente está indisponível. Use o guia ou fale com uma pessoa.', resolution: 'partial', actions: [{ type: 'link', destination: 'support', label: 'Falar com uma pessoa' }] }) }],
  erro: [{ ...question }, { id: 'e1', role: 'error', question: question.text, message: 'Tive um problema. Tente de novo.', status: 429 }],
};

const audit = (root) => {
  const failures = [];
  const measured = { text: 0, clickable: 0 };
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    if (el.matches('.ih-visually-hidden')) return false;
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const label = (el) => {
    if (el.id) return `#${el.id}`;
    const parts = [];
    for (let node = el; node && node !== root.parentElement && parts.length < 5; node = node.parentElement) {
      const classes = [...node.classList].filter((name) => name.startsWith('ih-')).slice(0, 2).map((name) => `.${name}`).join('');
      parts.unshift(`${node.localName}${classes}`);
    }
    return parts.join(' > ');
  };
  const rgba = (raw) => {
    const value = raw.match(/[\d.]+/g)?.map(Number) ?? [];
    return value.length >= 3 ? [value[0], value[1], value[2], value[3] ?? 1] : [0, 0, 0, 0];
  };
  const background = (el) => {
    let color = [0, 0, 0, 0];
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const next = rgba(getComputedStyle(node).backgroundColor);
      const alpha = next[3] * (1 - color[3]);
      const total = color[3] + alpha;
      if (total) color = [0, 1, 2].map((i) => (color[i] * color[3] + next[i] * alpha) / total).concat(total);
      if (color[3] >= .999) break;
    }
    return color[3] >= .999 ? color : [255, 255, 255, 1];
  };
  const luminance = (rgb) => rgb.slice(0, 3).map((value) => {
    const x = value / 255;
    return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (front, back) => {
    const values = [luminance(front), luminance(back)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  };
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const selector = label(el);
    const directText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const isField = el.matches('textarea,input');
    if (directText || isField) {
      measured.text++;
      const size = parseFloat(style.fontSize);
      if (size < 16) failures.push(`${selector}: fonte ${size}px < 16px`);
      const fg = rgba(isField && !el.value && el.getAttribute('placeholder')
        ? getComputedStyle(el, '::placeholder').color
        : style.color);
      const bg = background(el);
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) failures.push(`${selector}: contraste ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
    if (el.matches('a,button,summary,[role="button"],textarea,input') && !el.matches(':disabled')) {
      measured.clickable++;
      const height = el.getBoundingClientRect().height;
      if (height < 44) failures.push(`${selector}: altura ${height.toFixed(1)}px < 44px`);
    }
  }
  return { failures, measured };
};

const site = await startQaSite(out, basePath);
const browser = await launch();
const failures = [];
let textCount = 0;
let clickCount = 0;
try {
  const url = `${site.url}${basePath}/assistente/`;
  for (const [viewport, dimensions] of Object.entries(viewports)) {
    for (const [state, messages] of Object.entries(states)) {
      const page = await browser.newPage({ viewport: dimensions });
      await page.addInitScript((value) => sessionStorage.setItem('ih-assistant-v1', JSON.stringify({ messages: value, scope: 'Tudo', sessionId: 'qa-session' })), messages);
      await page.goto(url, { waitUntil: 'networkidle' });
      if (process.env.ASSISTANT_LEGIBILITY_PROBE_CSS) {
        await page.addStyleTag({ content: process.env.ASSISTANT_LEGIBILITY_PROBE_CSS });
      }
      const root = page.locator('.ih-ai-screen');
      await root.waitFor();
      await page.locator('.ih-ai-thread').waitFor();
      const expected = { normal: '.ih-ai-sources', guia: '.ih-ai-steps li', fallback: '.ih-ai-human-action', erro: '.ih-ai-error' };
      assert.ok(await root.locator(expected[state]).first().isVisible(), `${state}/${viewport}: estado não foi renderizado`);
      const targets = await page.locator('.ih-ai-screen a, .ih-ai-screen button, .ih-ai-screen textarea, .ih-ai-screen summary').evaluateAll((els) => els.flatMap((el, i) => el.getClientRects().length && !el.matches(':disabled') ? [i] : []));
      const collect = async (mode) => {
        const result = await root.evaluate(audit);
        textCount += result.measured.text;
        clickCount += result.measured.clickable;
        failures.push(...result.failures.map((item) => `${state}/${viewport}/${mode}: ${item}`));
      };
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await collect('repouso');
      for (const target of targets) {
        const item = page.locator('.ih-ai-screen a, .ih-ai-screen button, .ih-ai-screen textarea, .ih-ai-screen summary').nth(target);
        if (!(await item.isVisible()) || !(await item.isEnabled())) continue;
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        await item.hover();
        await collect(`hover${target}`);
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        let keyboardFocused = false;
        for (let attempt = 0; attempt < targets.length * 2 + 8; attempt++) {
          await page.keyboard.press('Tab');
          if (await item.evaluate((el) => el === document.activeElement && el.matches(':focus-visible'))) {
            keyboardFocused = true;
            break;
          }
        }
        if (!keyboardFocused) failures.push(`${state}/${viewport}/teclado${target}: foco por Tab indisponível`);
        else await collect(`teclado${target}`);
      }
      for (const field of await page.locator('.ih-ai-screen textarea, .ih-ai-screen input').all()) {
        if (!(await field.isVisible()) || !(await field.isEnabled())) continue;
        await field.fill('Texto de teste');
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
        await collect('campo preenchido');
      }
      await page.close();
    }
    for (const zoom of [1, 2]) {
      const page = await browser.newPage({ viewport: dimensions, deviceScaleFactor: zoom });
      await page.goto(`${site.url}${basePath}/docs/guias/?origem=suporte`, { waitUntil: 'networkidle' });
      const catalog = page.locator('.ih-guide-catalog');
      assert.ok(await catalog.isVisible(), `catálogo/${viewport}/${zoom}: catálogo ausente`);
      assert.equal(await catalog.locator('a.ih-guide-card').count(), 3, 'catálogo vem dos três guias canônicos');
      failures.push(...(await catalog.evaluate(audit)).failures.map((item) => `catálogo/${viewport}/${zoom}: ${item}`));
      const link = catalog.getByRole('link', { name: /Reconectar o WhatsApp/ });
      await link.focus();
      assert.ok(await link.evaluate((el) => el.matches(':focus-visible')), 'catálogo: foco por teclado');
      await link.click();
      await page.waitForURL(/reconectar-canal-qr/);
      assert.equal(new URL(page.url()).searchParams.get('origem'), 'suporte', 'origem preservada');
      const guide = page.locator('.ih-guide-page');
      assert.ok(await guide.isVisible(), 'página do guia canônico');
      assert.equal(await guide.locator('a.ih-guide-app').count(), 1, 'Fazer no app');
      assert.match(await guide.locator('a.ih-guide-app').getAttribute('href'), /ihelpGuide=reconectar-canal-qr/);
      assert.ok(await guide.getByRole('link', { name: 'Falar com uma pessoa' }).isVisible(), 'humano sempre disponível');
      await guide.getByRole('button', { name: 'Uso Android' }).click();
      assert.ok(await guide.getByText(/No Android, abra WhatsApp/).isVisible());
      await guide.getByRole('button', { name: 'Voltar' }).click();
      await guide.getByRole('button', { name: 'Uso iPhone' }).click();
      assert.ok(await guide.getByText(/No iPhone, abra WhatsApp/).isVisible(), 'escolha corrigível');
      failures.push(...(await guide.evaluate(audit)).failures.map((item) => `guia/${viewport}/${zoom}: ${item}`));
      assert.equal(await page.getByText(/Procedimento não documentado|Parte da resposta exige atendimento/i).count(), 0, 'sem etiquetas');
      await page.close();
    }
  }
} finally {
  await browser.close();
  await site.close();
}
assert.ok(textCount > 100 && clickCount > 50, `cobertura insuficiente: ${textCount} textos, ${clickCount} clicáveis`);
for (const item of [...new Set(failures.map((failure) => failure.replace(/\/interactive\d+:/, '/interactive:')))].slice(0, 100)) console.error(`FALHA ${item}`);
assert.equal(failures.length, 0, `${failures.length} falhas de legibilidade`);
console.log(`qa:assistant: ${Object.keys(states).length} estados × ${Object.keys(viewports).length} viewports; ${textCount} textos, ${clickCount} clicáveis; 0 falhas.`);
