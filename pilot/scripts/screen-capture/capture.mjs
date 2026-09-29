import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { launch } from '../visual/measure.mjs';
import { assertAllowedTarget, installQaNetworkGuard, loginToQa } from '../guide-proof.mjs';
import { containsSensitiveData } from '../../mcp/sensitive-data.mjs';
import { credentialsFromEnv } from '../guide-proof.mjs';
import { isUnsafeCaptureAction } from '../../mcp/faq-editorial.mjs';
import { screenshotFile, screenshotHash, writeScreenshot } from '../../mcp/screenshot-files.mjs';

const slug = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const sha = /^[a-f0-9]{40}$/u;
const routePattern = /^\/(?!\/)[a-z0-9/_-]*$/u;
const outputRoot = resolve(import.meta.dirname, '../../public/img/mcp');

const normalized = (value) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
const controlKey = (value) => normalized(String(value ?? '')).replace(/\s+/gu, '');
const menuTrigger = (label) => /^(?:mais op(?:c|ç)(?:o|õ)es|tr[eê]s pontos|menu)$/iu.test(label.trim());
const safeControlLabel = (value) => {
  const label = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return label.length > 0 && label.length <= 40 && /^[\p{L}\p{N} .,:;()!?+/-]+$/u.test(label)
    && !containsSensitiveData(label, { detectOpaque: true }) ? label : null;
};
const safePath = (url) => {
  try { const path = new URL(url).pathname; return /^\/[a-z0-9/_-]{0,160}$/iu.test(path) ? path : '[caminho omitido]'; }
  catch { return '[caminho omitido]'; }
};
const safeTitle = (title) => typeof title === 'string' && title.length <= 100
  && /^[\p{L}\p{N} .,()–-]*$/u.test(title) && !containsSensitiveData(title, { detectOpaque: true })
  ? title : '[título omitido]';

async function closeSafeNotice(page, target) {
  for (const frame of page.frames()) {
    if (new URL(frame.url()).origin !== target.url) continue;
    for (const dialog of await frame.getByRole('dialog').all()) {
      if (!await dialog.isVisible()) continue;
      const close = dialog.getByRole('button', { name: /^(?:fechar|dispensar|agora não|entendi)(?: aviso| janela)?$/iu });
      if (await close.count() === 1 && await close.isVisible()) await close.click({ timeout: 1500 });
    }
  }
}

async function findControl(page, target, step, timeoutMs = 20_000) {
  const roles = step.role === 'button' ? ['button', 'link', 'menuitem']
    : step.role === 'textbox' ? ['textbox', 'combobox'] : [step.role];
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  do {
    const candidates = [];
    for (const frame of page.frames()) {
      if (new URL(frame.url()).origin !== target.url) continue;
      const locators = step.role === 'text' ? [frame.getByText(step.label)]
        : roles.map((role) => frame.getByRole(role));
      for (const locator of locators) for (let index = 0, length = await locator.count(); index < length; index++) {
        const control = locator.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        const names = await control.evaluate((element) => {
          const described = (element.getAttribute('aria-describedby') ?? '').split(/\s+/u)
            .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '').filter(Boolean);
          return [element.innerText, element.getAttribute('aria-label'), element.getAttribute('title'),
            element.getAttribute('placeholder'), ...described];
        }).catch(() => []);
        if (names.some((name) => controlKey(name) === controlKey(step.label))) candidates.push(control);
      }
    }
    count = candidates.length;
    for (const control of candidates) {
      if (!await control.isEnabled().catch(() => false)) continue;
      const box = await control.boundingBox().catch(() => null);
      if (!box || box.width <= 0 || box.height <= 0) continue;
      try { await control.click({ trial: true, timeout: 1000 }); return { control, count }; }
      catch { /* outro candidato visível pode estar clicável */ }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(Math.min(500, deadline - Date.now()));
  } while (true);
  return { control: null, count };
}

async function openMenuFor(page, target, step) {
  const fact = step.menuTriggerFact;
  if (!fact || fact.opensMenuFor !== step.label || fact.text !== step.menuTrigger
    || fact.route !== step.route || fact.owner !== step.owner || fact.sha !== step.checkoutSha
    || isUnsafeCaptureAction(fact.text)) return { control: null, count: 0 };
  for (const frame of page.frames()) {
    if (new URL(frame.url()).origin !== target.url) continue;
    for (const role of ['button', 'link']) {
      const controls = frame.getByRole(role);
      for (let index = 0, length = await controls.count(); index < length; index++) {
        const control = controls.nth(index);
        if (!await control.isVisible().catch(() => false) || !await control.isEnabled().catch(() => false)) continue;
        const names = await control.evaluate((element) => [element.getAttribute('aria-label'),
          element.innerText, element.getAttribute('title')].filter(Boolean)).catch(() => []);
        if (!names.some((name) => controlKey(name) === controlKey(fact.text))
          || names.some(isUnsafeCaptureAction)) continue;
        try {
          await control.click({ timeout: 1500 });
          const found = await findControl(page, target, step, 1500);
          if (found.control) return found;
        } catch { /* o fato pode apontar para um controle indisponível */ }
      }
    }
  }
  return { control: null, count: 0 };
}

async function waitForLoading(page) {
  const loading = () => [...document.querySelectorAll('[aria-busy="true"],[role="progressbar"],[class*="skeleton" i],[class*="spinner" i],.animate-pulse,svg')]
    .some((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(element).visibility === 'hidden') return false;
      if (element.tagName.toLowerCase() !== 'svg') return true;
      return /carregando|loading/iu.test(element.querySelector('title')?.textContent ?? '')
        && element.querySelectorAll('rect').length >= 5;
    });
  try { await page.waitForFunction(`(${loading.toString()})() === false`, null, { timeout: 15_000, polling: 250 }); return false; }
  catch { return await page.evaluate(loading).catch(() => false); }
}

async function missingControlReason(page, target, count) {
  const labels = [];
  for (const frame of page.frames()) {
    if (new URL(frame.url()).origin !== target.url) continue;
    for (const role of ['button', 'link', 'menuitem']) {
      const controls = frame.getByRole(role);
      for (let index = 0, length = await controls.count(); index < length && labels.length < 20; index++) {
        const control = controls.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        const value = await control.evaluate((element) => {
          if (element.closest('table,[role="table"],[role="grid"],[role="row"]')) return null;
          return element.innerText || element.getAttribute('aria-label') || element.getAttribute('title');
        }).catch(() => null);
        const safe = safeControlLabel(value);
        if (safe && !labels.includes(safe)) labels.push(safe);
      }
    }
  }
  const spinner = await page.locator('[aria-busy="true"]:visible, [role="progressbar"]:visible, [class*="skeleton"]:visible').count() > 0;
  return `rótulo não encontrado: ${count} candidatos; controles: ${labels.join(' | ') || 'nenhum'}; spinner/skeleton: ${spinner ? 'sim' : 'não'}`;
}

export function faqStepMatches(body, facts = []) {
  if (typeof body !== 'string') throw new Error('FAQ aprovado inválido');
  const lines = body.split('\n');
  const steps = [];
  let numberedIndex = 0;
  let guideSection = false;
  for (const [lineIndex, line] of lines.entries()) {
    const heading = line.match(/^#{2,4}\s+(.+)/u);
    if (heading) {
      guideSection = /passo a passo|^como (?:criar|cadastrar|fazer|funciona a importação|configurar)/iu.test(heading[1]);
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.+)/u.exec(line);
    if (numbered) steps.push({ text: numbered[1], listIndex: numberedIndex++, line: lineIndex });
    else if (guideSection && /^\s*(?:Clique|Abra|Acesse|Escolha|Preencha)\b/iu.test(line))
      steps.push({ text: line.trim(), listIndex: null, line: lineIndex });
  }
  const matches = [];
  for (const step of steps) {
    const plain = normalized(step.text.replace(/\*\*|[“”"'`]/gu, ''));
    const found = facts.map((fact) => ({ label: fact.text, index: plain.indexOf(normalized(fact.text)) }))
      .filter(({ label, index }) => index >= 0 && !/[\p{L}\p{N}]/u.test(plain[index - 1] ?? '')
        && !/[\p{L}\p{N}]/u.test(plain[index + normalized(label).length] ?? ''))
      .sort((a, b) => a.index - b.index || b.label.length - a.label.length);
    const selected = [];
    for (const item of found) {
      const end = item.index + normalized(item.label).length;
      if (selected.some((previous) => item.index < previous.end && end > previous.index)) continue;
      selected.push({ index: item.index, end });
      matches.push({ label: item.label, listIndex: step.listIndex, line: step.line, column: item.index });
    }
  }
  return matches;
}

export const faqStepLabels = (body, facts) => faqStepMatches(body, facts).map((match) => match.label);

export function capturePlan({ page, module, faqBody, coverage, screenFacts }) {
  if (!slug.test(page) || !Array.isArray(screenFacts)) throw new Error('Plano de captura inválido');
  const entry = coverage.find((item) => item.module === module);
  if (!entry) throw new Error('Módulo ausente da coverage matrix');
  const routes = entry.productRoutes.filter((route) => routePattern.test(route) && !route.includes(':'));
  const eligible = screenFacts.filter((fact) => ['action', 'field'].includes(fact.kind)
    && fact.owner && sha.test(fact.sha ?? '') && typeof fact.text === 'string'
    && fact.text.length <= 160 && !/[\[\]\n\r]/u.test(fact.text) && !containsSensitiveData(fact.text)
    && (!fact.route || routes.includes(fact.route)));
  const matches = faqStepMatches(faqBody, eligible);
  if (!matches.length) throw new Error('Nenhum fato da tela confirmado nos passos do FAQ');
  const selected = matches.map((match) => ({ fact: eligible.find((fact) =>
    fact.text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
      === match.label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')), match }))
    .filter(({ fact }) => fact);
  if (!routes.length || !selected.length) throw new Error('Nenhum fato da tela confirmado para captura');
  return selected.slice(0, 20).map(({ fact, match }, index) => {
    const step = `${String(index + 1).padStart(2, '0')}-${fact.text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 55)}`;
    const label = fact.text;
    const source = /^(.*):(\d+)$/u.exec(fact.source ?? '');
    const trigger = source && screenFacts.filter((candidate) => {
      const earlier = /^(.*):(\d+)$/u.exec(candidate.source ?? '');
      return earlier && earlier[1] === source[1] && Number(earlier[2]) < Number(source[2])
        && Number(source[2]) - Number(earlier[2]) <= 80 && candidate.route === fact.route
        && candidate.owner === fact.owner && candidate.sha === fact.sha
        && candidate.opensMenuFor === fact.text && !isUnsafeCaptureAction(candidate.text ?? '');
    }).sort((a, b) => Number(b.source.split(':').at(-1)) - Number(a.source.split(':').at(-1)))[0];
    return { page, step, listIndex: match.listIndex, line: match.line,
      role: fact.kind === 'field' ? 'textbox' : 'button', label,
      ...(trigger ? { menuTrigger: trigger.text, menuTriggerFact: {
        text: trigger.text, opensMenuFor: trigger.opensMenuFor, route: trigger.route,
        owner: trigger.owner, sha: trigger.sha } } : {}),
      route: fact.route ?? routes[0], owner: fact.owner, checkoutSha: fact.sha, alt: `Tela de ${module}: ${label}`,
      action: fact.kind === 'action' && (/^(?:abrir|ver|mostrar|acessar)\b/iu.test(label)
        || menuTrigger(label) && (selected[index + 1]?.match?.line > match.line
          || selected[index + 1]?.match?.line === match.line && selected[index + 1]?.match?.column > match.column)
          && (selected[index + 1]?.fact?.route ?? routes[0]) === (fact.route ?? routes[0]))
        && !isUnsafeCaptureAction(label) ? 'click' : 'none' };
  });
}

function checkedPath(page, step) {
  if (!slug.test(page) || !slug.test(step)) throw new Error('Caminho de imagem inválido');
  return `/img/mcp/${page}/${step}.png`;
}

export function chooseScreenshot(manifest, page, step) {
  const matches = manifest.entries.filter((entry) => entry.page === page && entry.step === step);
  return matches.find((entry) => entry.source === 'upload' && entry.status === 'approved')
    ?? matches.find((entry) => entry.source === 'automatic' && entry.status !== 'discarded' && entry.status !== 'pending') ?? null;
}

export function masksCoverSensitive(sensitive, masks) {
  return sensitive.every((rect) => masks.some((mask) => mask.x <= rect.x && mask.y <= rect.y
    && mask.x + mask.width >= rect.x + rect.width
    && mask.y + mask.height >= rect.y + rect.height));
}

export async function addUploadedScreenshot({ manifest, page, step, file, bytes, alt, label, route, root = outputRoot }) {
  checkedPath(page, step);
  if (!alt || containsSensitiveData(alt)
    || label && containsSensitiveData(label) || route && !routePattern.test(route))
    throw new Error('Upload requer revisão de privacidade');
  const image = bytes ?? await readFile(file);
  const signature = image.subarray(0, 8).toString('hex');
  const extension = signature === '89504e470d0a1a0a' ? 'png' : image.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpg' : null;
  if (!extension || image.length > 2 * 1024 * 1024) throw new Error('Upload precisa ser PNG/JPEG de até 2 MiB');
  const imageFile = screenshotFile(page, step, 'upload', image, extension);
  await writeScreenshot(root, { page, step, source: 'upload', file: imageFile, sha256: screenshotHash(image) }, image);
  const previous = chooseScreenshot(manifest, page, step);
  manifest.entries = manifest.entries.filter((entry) => entry.page !== page || entry.step !== step || entry.source !== 'upload');
  manifest.entries.push({ page, step, label: previous?.label ?? label ?? null, route: previous?.route ?? route ?? null,
    owner: previous?.owner ?? null, checkoutSha: previous?.checkoutSha ?? null,
    listIndex: previous?.listIndex ?? null, line: previous?.line ?? null,
    file: imageFile, sha256: screenshotHash(image), alt, bundleSha: null, source: 'upload', status: 'pending', masked: [] });
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function scanVisible(page) {
  const items = [];
  for (const frame of page.frames()) {
    let offset = { x: 0, y: 0 };
    if (frame !== page.mainFrame()) {
      try {
        if (new URL(frame.url()).origin !== new URL(page.url()).origin) continue;
        const box = await (await frame.frameElement()).boundingBox();
        if (!box) continue;
        offset = { x: box.x, y: box.y };
      } catch { continue; }
    }
    const found = await frame.evaluate(() => {
    const items = [];
    const inDataRegion = (element) => Boolean(element.closest('tbody tr,[role="rowgroup"] [role="row"], [role="listitem"], [data-testid*="contact"], [data-testid*="conversation"], header [class*="profile"], header [class*="user"], [role="banner"] [class*="profile"], [role="banner"] [class*="user"]'));
    const add = (text, rects, reason, force = false) => {
      if (!text?.trim()) return;
      for (const rect of rects) if (rect.width > 0 && rect.height > 0
        && rect.right > 0 && rect.bottom > 0 && rect.x < innerWidth && rect.y < innerHeight)
        items.push({ text, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, reason, force });
    };
    const roots = [document.body];
    for (let index = 0; index < roots.length; index++) {
      const root = roots[index];
      for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode());) {
        const element = node.parentElement;
        if (!element || element.closest('[data-screen-capture-overlay],svg,[aria-hidden="true"]')
          || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const profile = Boolean(element.closest('header [class*="profile"], header [class*="user"], [role="banner"] [class*="profile"], [role="banner"] [class*="user"]'));
        const first = items.length;
        add(node.textContent, range.getClientRects(), inDataRegion(element) ? 'campo ou conteúdo dinâmico' : 'texto não confirmado', profile);
        const tab = element.closest('a,[role="tab"]');
        if (tab) for (const item of items.slice(first)) item.context = tab.innerText;
      }
      for (const element of root.querySelectorAll('input,textarea')) {
        add(element.value, element.getClientRects(), 'campo ou conteúdo dinâmico', true);
        add(element.placeholder, element.getClientRects(), 'texto não confirmado');
      }
      for (const element of root.querySelectorAll('img,canvas,video')) if (inDataRegion(element))
        add('conteúdo dinâmico', element.getClientRects(), 'campo ou conteúdo dinâmico', true);
    }
    return items;
    });
    items.push(...found.map((item) => ({ ...item, rect: { ...item.rect,
      x: item.rect.x + offset.x, y: item.rect.y + offset.y } })));
  }
  for (const frame of page.frames().slice(1)) {
    try {
      if (new URL(frame.url()).origin === new URL(page.url()).origin) continue;
      const box = await (await frame.frameElement()).boundingBox();
      if (box) items.push({ text: 'conteúdo dinâmico', rect: box, reason: 'campo ou conteúdo dinâmico' });
    } catch { /* frame removido durante a varredura */ }
  }
  return items;
}

const visibleHash = (items) => createHash('sha256').update(JSON.stringify(items)).digest('hex');

const vocabularyKey = (value) => controlKey(value).replace(/[\p{P}\p{S}]/gu, '');
function inVocabulary(text, vocabulary) {
  const key = vocabularyKey(text);
  if (!key) return false;
  return vocabulary.some((word) => {
    const slots = [...String(word).matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]);
    const parts = String(word).split(/\{[^{}]+\}/u).map(vocabularyKey);
    if (parts.length === 1) return parts[0] === key || key.startsWith(parts[0]) && /^\d+$/u.test(key.slice(parts[0].length));
    const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`^${parts.map(escape).reduce((result, part, index) =>
      index ? `${result}${/^(?:count|contador|numero|número)$/iu.test(slots[index - 1]) ? '\\d+' : '.+'}${part}` : part, '')}$`, 'u');
    return pattern.test(key);
  });
}

function masksForVisible(visible, vocabulary) {
  return visible.flatMap((item) => {
    const sensitive = containsSensitiveData(item.text, { detectOpaque: true });
    const known = inVocabulary(item.text, vocabulary) || item.context && inVocabulary(item.context, vocabulary);
    if (!sensitive && !item.force && known) return [];
    return [{ ...item.rect, reason: sensitive ? 'varredura sensível' : item.reason }];
  });
}

async function captureAttempt(page, cdp, rect, vocabulary, destination, afterScreenshot) {
  let frozen = false;
  try {
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    frozen = true;
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.setAttribute('data-screen-capture-pause', '');
      style.textContent = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}';
      document.head.append(style);
    });
    const visible = await scanVisible(page);
    const mask = masksForVisible(visible, vocabulary);
    const sensitive = [];
    for (const item of visible) {
      const isSensitive = containsSensitiveData(item.text, { detectOpaque: true });
      if (isSensitive) sensitive.push(item.rect);
    }
    if (!masksCoverSensitive(sensitive, mask)) return { failure: 'máscara não cobriu' };
    await page.evaluate(({ masks, rect: target }) => {
      const layer = document.createElement('div');
      layer.setAttribute('data-screen-capture-overlay', '');
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      for (const area of masks) {
        const box = document.createElement('div');
        box.setAttribute('data-screen-capture-mask', '');
        box.style.cssText = `position:absolute;left:${area.x}px;top:${area.y}px;width:${area.width}px;height:${area.height}px;background:#E2E8F0;border-radius:4px;`;
        layer.append(box);
      }
      const frame = document.createElement('div');
      frame.style.cssText = `position:absolute;left:${target.x - 5}px;top:${target.y - 5}px;width:${target.width + 10}px;height:${target.height + 10}px;border:4px solid #ec6400;border-radius:5px;box-sizing:border-box`;
      const arrow = document.createElement('div');
      arrow.textContent = '➜';
      arrow.style.cssText = `position:absolute;left:${Math.max(0, target.x - 38)}px;top:${Math.max(0, target.y - 8)}px;color:#ec6400;font:bold 32px sans-serif;text-shadow:0 1px white`;
      layer.append(frame, arrow); document.body.append(layer);
    }, { masks: mask, rect });
    const renderedMasks = await page.evaluate(() => [...document.querySelectorAll('[data-screen-capture-mask]')]
      .map((box) => { const area = box.getBoundingClientRect();
        return { x: area.x, y: area.y, width: area.width, height: area.height }; }));
    if (!masksCoverSensitive(sensitive, renderedMasks)) return { failure: 'máscara não cobriu' };
    await page.screenshot({ path: destination, animations: 'disabled' });
    const bytes = await readFile(destination);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (rect.x < 5 || rect.y < 8 || rect.x + rect.width + 5 > width || rect.y + rect.height + 5 > height)
      return { failure: 'alvo fora da tela' };
    if (afterScreenshot) await afterScreenshot(page);
    const after = await scanVisible(page);
    const remaining = masksForVisible(after, vocabulary).map((item) => item);
    if (visibleHash(visible) !== visibleHash(after) || !masksCoverSensitive(remaining, renderedMasks))
      return { failure: 'máscara não cobriu' };
    return { mask, bytes };
  } finally {
    await rm(destination, { force: true }).catch(() => {});
    await page.evaluate(() => {
      document.querySelector('[data-screen-capture-overlay]')?.remove();
      document.querySelector('[data-screen-capture-pause]')?.remove();
    }).catch(() => {});
    if (frozen) await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
  }
}

async function scrollControlIntoCapture(page, control) {
  await control.evaluate(async (element) => {
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    let previous = null;
    let stable = 0;
    for (let frame = 0; frame < 60 && stable < 2; frame++) {
      await new Promise((done) => requestAnimationFrame(done));
      const rect = element.getBoundingClientRect();
      const position = [rect.x, rect.y, rect.width, rect.height];
      stable = previous && position.every((value, index) => value === previous[index]) ? stable + 1 : 0;
      previous = position;
    }
  });
  return control.boundingBox();
}

export async function captureScreens({ baseUrl, plan, storageState, fixture = false,
  manifest = { version: 1, entries: [] }, root = outputRoot, env = process.env, fixtureAfterScreenshot,
  fixtureCredentials, fixtureOnRequestFailed, fixtureBeforeStep, vocabulary = [] }) {
  if (fixtureAfterScreenshot && (!fixture || typeof fixtureAfterScreenshot !== 'function'))
    throw new Error('Hook de fixture inválido');
  if ((fixtureCredentials || fixtureOnRequestFailed || fixtureBeforeStep) && !fixture)
    throw new Error('Hook de fixture inválido');
  const target = assertAllowedTarget(baseUrl, env);
  if (target.local !== fixture) throw new Error('Modo e host incompatíveis');
  if (!Array.isArray(plan) || !plan.length || plan.some((step) => !slug.test(step.page)
    || !slug.test(step.step) || !routePattern.test(step.route) || !step.label))
    throw new Error('Plano interno inválido');
  if (!fixture && !storageState && !credentialsFromEnv(env).authorized.password) throw new Error('Sessão de QA ausente');
  if (storageState && resolve(storageState).startsWith(resolve(import.meta.dirname, '../../..') + '/'))
    throw new Error('storageState precisa ficar fora do repositório');
  const browser = await launch();
  try {
    const context = await browser.newContext({ ...(storageState ? { storageState } : {}), serviceWorkers: 'block' });
    const networkGuard = await installQaNetworkGuard(context, target, env);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(10000);
    const eventFailures = [];
    page.on('requestfailed', (request) => {
      try {
        // Only fixture code can inject a failure here. Never expose Playwright's
        // raw error or headers in the capture result.
        fixtureOnRequestFailed?.(request);
      } catch { eventFailures.push('handler de requisição falhou'); }
    });
    if (fixtureCredentials || !fixture && !storageState) {
      try { await loginToQa(page, target.url, fixtureCredentials ?? credentialsFromEnv(env).authorized, { networkGuard, timeoutMs: 5000 }); }
      catch (error) { throw new Error('Login na homologação falhou', { cause: error }); }
    }
    let currentRoute = null;
    let bundleSha = null;
    const outcomes = [];
    for (const step of plan) {
      const outcome = { step: step.step, label: step.label, status: 'pendente', motivo: 'tempo do passo esgotado',
        finalPath: '[caminho omitido]', pageTitle: '[título omitido]', candidates: 0 };
      outcomes.push(outcome);
      try {
      if (fixtureBeforeStep) await fixtureBeforeStep(step);
      const pendingUpload = manifest.entries.find((entry) => entry.page === step.page && entry.step === step.step
        && entry.source === 'upload' && entry.status === 'pending');
      if (pendingUpload) {
        if (pendingUpload.label && pendingUpload.label !== step.label
          || pendingUpload.route && pendingUpload.route !== step.route
          || pendingUpload.owner && pendingUpload.owner !== step.owner)
          throw new Error('Upload não corresponde ao fato da tela');
        Object.assign(pendingUpload, { label: step.label, route: step.route, owner: step.owner,
          checkoutSha: step.checkoutSha, listIndex: step.listIndex, line: step.line });
      }
      const uploaded = chooseScreenshot(manifest, step.page, step.step);
      if (uploaded?.source === 'upload' && uploaded.status === 'approved') {
        if (uploaded.label && uploaded.label !== step.label || uploaded.route && uploaded.route !== step.route
          || uploaded.owner && uploaded.owner !== step.owner) throw new Error('Upload não corresponde ao fato da tela');
        uploaded.label = step.label;
        uploaded.route = step.route;
        uploaded.owner = step.owner;
        uploaded.checkoutSha = step.checkoutSha;
      }
      if (currentRoute !== step.route) {
        try { await page.goto(`${target.url}${step.route}`, { waitUntil: 'domcontentloaded' }); }
        catch (error) {
          const blocked = networkGuard.blocked.at(-1);
          outcome.motivo = blocked ? `bloqueado pela lista de hosts: ${blocked.host}` : 'tempo do passo esgotado';
          outcome.finalPath = safePath(page.url());
          outcome.pageTitle = safeTitle(await page.title().catch(() => ''));
          throw error;
        }
        currentRoute = step.route;
        const bundle = await page.locator('script[src]').evaluateAll((nodes) => nodes.map((node) => node.src)
          .find((url) => new URL(url).origin === location.origin && /\.js(?:\?|$)/u.test(url)) ?? null);
        const content = bundle ? Buffer.from(await (await page.request.get(bundle)).body()) : Buffer.from(await page.content());
        bundleSha = createHash('sha1').update(content).digest('hex');
      }
      const current = new URL(page.url());
      outcome.finalPath = safePath(page.url());
      outcome.pageTitle = safeTitle(await page.title());
      if (current.origin !== target.url || current.pathname !== step.route && !current.pathname.startsWith(`${step.route}/`)) {
        outcome.motivo = `rota não abriu: ${outcome.finalPath}`;
        throw new Error('Navegação fora da rota confirmada');
      }
      await closeSafeNotice(page, target);
      let { control, count } = await findControl(page, target, step, step.menuTrigger ? 1000 : 20_000);
      if (!control) ({ control, count } = await openMenuFor(page, target, step));
      outcome.candidates = count;
      if (!control) {
        outcome.motivo = count ? 'alvo fora da tela' : await missingControlReason(page, target, count);
        throw new Error('Rótulo ausente ou não clicável');
      }
      if (!['click', 'none'].includes(step.action)) throw new Error('Ação não permitida');
      if (await waitForLoading(page)) {
        outcome.motivo = 'print com carregamento';
        outcome.status = 'descartado';
        manifest.entries = manifest.entries.filter((entry) => entry.page !== step.page || entry.step !== step.step || entry.source !== 'automatic');
        manifest.entries.push({ page: step.page, step: step.step, label: step.label, route: step.route,
          owner: step.owner, source: 'automatic', status: 'discarded', reason: 'print com carregamento' });
        manifest.pending = [...new Set([...(manifest.pending ?? []), `print com carregamento: ${step.step}`])];
        continue;
      }
      await mkdir(join(root, step.page), { recursive: true });
      const cdp = await context.newCDPSession(page);
      let captured = null;
      try {
        for (let attempt = 0; attempt < 2 && !captured?.bytes; attempt++) {
          const rect = await scrollControlIntoCapture(page, control);
          if (!rect) { outcome.motivo = 'alvo fora da tela'; throw new Error('Elemento fora da tela'); }
          captured = await captureAttempt(page, cdp, rect, [...vocabulary, ...plan.map((item) => item.label)],
            join(root, step.page, `${step.step}.pending.png`), fixtureAfterScreenshot);
        }
      } finally { await cdp.detach(); }
      if (!captured?.bytes) {
        outcome.status = 'descartado';
        outcome.motivo = captured?.failure ?? 'máscara não cobriu';
        manifest.entries = manifest.entries.filter((entry) => entry.page !== step.page || entry.step !== step.step || entry.source !== 'automatic');
        manifest.pending = [...new Set([...(manifest.pending ?? []), `print descartado: destaque fora da imagem ou dado sensível sem máscara em ${step.route}`])];
        continue;
      }
      const image = screenshotFile(step.page, step.step, 'automatic', captured.bytes, 'png');
      const sha256 = screenshotHash(captured.bytes);
      await writeScreenshot(root, { page: step.page, step: step.step, source: 'automatic', file: image, sha256 }, captured.bytes);
      const mask = captured.mask;
      if (step.action === 'click' && !isUnsafeCaptureAction(step.label)
        && (/^(?:abrir|ver|mostrar|acessar)\b/iu.test(step.label) || menuTrigger(step.label))) {
        const names = await control.evaluate((element) => [element.getAttribute('aria-label'),
          element.innerText, element.getAttribute('title')].filter(Boolean)).catch(() => []);
        if (!names.some(isUnsafeCaptureAction)) await control.click();
      }
      manifest.entries = manifest.entries.filter((entry) => entry.page !== step.page || entry.step !== step.step || entry.source !== 'automatic');
      manifest.entries.push({ page: step.page, step: step.step, label: step.label, route: step.route,
        listIndex: step.listIndex, line: step.line,
        owner: step.owner, file: image, sha256, alt: step.alt, bundleSha, checkoutSha: step.checkoutSha,
        source: 'automatic', status: 'captured', masked: [...new Set(mask.map((item) => item.reason))] });
      manifest.pending = (manifest.pending ?? []).filter((item) => item !== `print com carregamento: ${step.step}`);
      outcome.status = 'capturado';
      if (outcome.motivo !== 'print com carregamento') outcome.motivo = 'capturado';
      } catch {
        manifest.entries = manifest.entries.filter((entry) => entry.page !== step.page || entry.step !== step.step || entry.source !== 'automatic');
        manifest.pending = [...new Set([...(manifest.pending ?? []), `captura pendente: ${step.step}`])];
        currentRoute = null;
      }
    }
    if (eventFailures.length) manifest.pending = [...new Set([...(manifest.pending ?? []), ...eventFailures])];
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    Object.defineProperty(manifest, 'steps', { value: outcomes, configurable: true });
    return manifest;
  } finally { await browser.close(); }
}
