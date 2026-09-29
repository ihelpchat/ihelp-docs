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
      matches.push({ label: item.label, listIndex: step.listIndex, line: step.line });
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
    return { page, step, listIndex: match.listIndex, line: match.line,
      role: fact.kind === 'field' ? 'textbox' : 'button', label,
      route: fact.route ?? routes[0], owner: fact.owner, checkoutSha: fact.sha, alt: `Tela de ${module}: ${label}`,
      action: fact.kind === 'action' && /^(?:abrir|ver|mostrar|acessar)\b/iu.test(label)
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
    ?? matches.find((entry) => entry.source === 'automatic') ?? null;
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
  return page.evaluate(() => {
    const items = [];
    const add = (text, rects, reason) => {
      if (!text?.trim()) return;
      for (const rect of rects) if (rect.width > 0 && rect.height > 0
        && rect.right > 0 && rect.bottom > 0 && rect.x < innerWidth && rect.y < innerHeight)
        items.push({ text, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, reason });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const element = node.parentElement;
      if (!element || element.closest('[data-screen-capture-overlay]')
        || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
      const range = document.createRange(); range.selectNodeContents(node);
      add(node.textContent, range.getClientRects(), 'texto não confirmado');
    }
    for (const element of document.querySelectorAll('input,textarea')) {
      add(element.value, element.getClientRects(), 'campo ou conteúdo dinâmico');
      add(element.placeholder, element.getClientRects(), 'campo ou conteúdo dinâmico');
    }
    for (const element of document.querySelectorAll('img,svg,canvas,video,iframe,tbody td'))
      add('conteúdo dinâmico', element.getClientRects(), 'campo ou conteúdo dinâmico');
    return items;
  });
}

const visibleHash = (items) => createHash('sha256').update(JSON.stringify(items)).digest('hex');

async function captureAttempt(page, cdp, rect, allowedLabels, destination, afterScreenshot) {
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
    const mask = [];
    const sensitive = [];
    for (const item of visible) {
      const isSensitive = containsSensitiveData(item.text, { detectOpaque: true });
      if (isSensitive) sensitive.push(item.rect);
      if (isSensitive || item.reason === 'campo ou conteúdo dinâmico' || !allowedLabels.includes(item.text.trim()))
        mask.push({ ...item.rect, reason: isSensitive ? 'varredura sensível' : item.reason });
    }
    if (!masksCoverSensitive(sensitive, mask)) return null;
    await page.evaluate(({ masks, rect: target }) => {
      const privacyStyle = document.createElement('style');
      privacyStyle.setAttribute('data-screen-capture-style', '');
      privacyStyle.textContent = 'body * {background-image:none!important} body *::before,body *::after {content:none!important}';
      document.head.append(privacyStyle);
      const layer = document.createElement('div');
      layer.setAttribute('data-screen-capture-overlay', '');
      layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
      for (const area of masks) {
        const box = document.createElement('div');
        box.setAttribute('data-screen-capture-mask', '');
        box.style.cssText = `position:absolute;left:${area.x}px;top:${area.y}px;width:${area.width}px;height:${area.height}px;background:#111;`;
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
    if (!masksCoverSensitive(sensitive, renderedMasks)) return null;
    await page.screenshot({ path: destination, animations: 'disabled' });
    const bytes = await readFile(destination);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (rect.x < 5 || rect.y < 8 || rect.x + rect.width + 5 > width || rect.y + rect.height + 5 > height)
      return null;
    if (afterScreenshot) await afterScreenshot(page);
    const after = await scanVisible(page);
    const remaining = after.filter((item) => containsSensitiveData(item.text, { detectOpaque: true })).map((item) => item.rect);
    if (visibleHash(visible) !== visibleHash(after) || !masksCoverSensitive(remaining, renderedMasks)) return null;
    return { mask, bytes };
  } finally {
    await rm(destination, { force: true }).catch(() => {});
    await page.evaluate(() => {
      document.querySelector('[data-screen-capture-overlay]')?.remove();
      document.querySelector('[data-screen-capture-style]')?.remove();
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
  manifest = { version: 1, entries: [] }, root = outputRoot, env = process.env, fixtureAfterScreenshot }) {
  if (fixtureAfterScreenshot && (!fixture || typeof fixtureAfterScreenshot !== 'function'))
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
    if (!fixture && !storageState) {
      try { await loginToQa(page, target.url, credentialsFromEnv(env).authorized, { networkGuard }); }
      catch (error) { throw new Error('Login na homologação falhou', { cause: error }); }
    }
    let currentRoute = null;
    let bundleSha = null;
    for (const step of plan) {
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
        await page.goto(`${target.url}${step.route}`, { waitUntil: 'domcontentloaded' });
        currentRoute = step.route;
        const bundle = await page.locator('script[src]').evaluateAll((nodes) => nodes.map((node) => node.src)
          .find((url) => new URL(url).origin === location.origin && /\.js(?:\?|$)/u.test(url)) ?? null);
        const content = bundle ? Buffer.from(await (await page.request.get(bundle)).body()) : Buffer.from(await page.content());
        bundleSha = createHash('sha1').update(content).digest('hex');
      }
      const current = new URL(page.url());
      if (current.origin !== target.url || current.pathname !== step.route && !current.pathname.startsWith(`${step.route}/`))
        throw new Error('Navegação fora da rota confirmada');
      const roles = step.role === 'button' ? ['button', 'link', 'menuitem']
        : step.role === 'textbox' ? ['textbox', 'combobox'] : [step.role];
      const candidates = roles.map((role) => page.getByRole(role, { name: step.label, exact: true }));
      const control = step.role === 'text' ? page.getByText(step.label, { exact: true })
        : candidates[(await Promise.all(candidates.map((candidate) => candidate.count()))).findIndex((count) => count > 0)]
          ?? candidates[0];
      await control.waitFor({ state: 'visible' });
      if (await control.count() !== 1) throw new Error('Rótulo ausente ou ambíguo');
      if (!['click', 'none'].includes(step.action)) throw new Error('Ação não permitida');
      await mkdir(join(root, step.page), { recursive: true });
      const cdp = await context.newCDPSession(page);
      let captured = null;
      try {
        for (let attempt = 0; attempt < 2 && !captured; attempt++) {
          const rect = await scrollControlIntoCapture(page, control);
          if (!rect) throw new Error('Elemento fora da tela');
          captured = await captureAttempt(page, cdp, rect, plan.map((item) => item.label),
            join(root, step.page, `${step.step}.pending.png`), fixtureAfterScreenshot);
        }
      } finally { await cdp.detach(); }
      if (!captured) {
        manifest.entries = manifest.entries.filter((entry) => entry.page !== step.page || entry.step !== step.step || entry.source !== 'automatic');
        manifest.pending = [...new Set([...(manifest.pending ?? []), `print descartado: destaque fora da imagem ou dado sensível sem máscara em ${step.route}`])];
        continue;
      }
      const image = screenshotFile(step.page, step.step, 'automatic', captured.bytes, 'png');
      const sha256 = screenshotHash(captured.bytes);
      await writeScreenshot(root, { page: step.page, step: step.step, source: 'automatic', file: image, sha256 }, captured.bytes);
      const mask = captured.mask;
      if (step.action === 'click' && !isUnsafeCaptureAction(step.label)
        && /^(?:abrir|ver|mostrar|acessar)\b/iu.test(step.label)) await control.click();
      manifest.entries = manifest.entries.filter((entry) => entry.page !== step.page || entry.step !== step.step || entry.source !== 'automatic');
      manifest.entries.push({ page: step.page, step: step.step, label: step.label, route: step.route,
        listIndex: step.listIndex, line: step.line,
        owner: step.owner, file: image, sha256, alt: step.alt, bundleSha, checkoutSha: step.checkoutSha,
        source: 'automatic', masked: [...new Set(mask.map((item) => item.reason))] });
    }
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally { await browser.close(); }
}
