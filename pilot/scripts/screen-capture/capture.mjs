import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { launch } from '../visual/measure.mjs';
import { assertAllowedTarget } from '../guide-proof.mjs';
import { containsSensitiveData } from '../../mcp/sensitive-data.mjs';
import { credentialsFromEnv } from '../guide-proof.mjs';
import { isUnsafeCaptureAction } from '../../mcp/faq-editorial.mjs';

const slug = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const sha = /^[a-f0-9]{40}$/u;
const routePattern = /^\/(?!\/)[a-z0-9/_-]*$/u;
const outputRoot = resolve(import.meta.dirname, '../../public/img/mcp');

export function capturePlan({ page, module, tasks = [], coverage, screenFacts }) {
  if (!slug.test(page) || !Array.isArray(screenFacts) || !Array.isArray(tasks)
    || tasks.some((task) => typeof task !== 'string' || task.length > 120)) throw new Error('Plano de captura inválido');
  const entry = coverage.find((item) => item.module === module);
  if (!entry) throw new Error('Módulo ausente da coverage matrix');
  const routes = entry.productRoutes.filter((route) => routePattern.test(route) && !route.includes(':'));
  const selected = screenFacts.filter((fact) => ['action', 'field'].includes(fact.kind)
    && fact.owner && sha.test(fact.sha ?? '') && typeof fact.text === 'string'
    && fact.text.length <= 160 && !/[\[\]\n\r]/u.test(fact.text) && !containsSensitiveData(fact.text)
    && (!fact.route || routes.includes(fact.route))
    && (!tasks.length || tasks.some((task) => `${fact.text} ${fact.subject ?? ''}`.toLocaleLowerCase('pt-BR')
      .includes(task.toLocaleLowerCase('pt-BR')))));
  if (!routes.length || !selected.length) throw new Error('Nenhum fato da tela confirmado para captura');
  return selected.slice(0, 20).map((fact, index) => {
    const step = `${String(index + 1).padStart(2, '0')}-${fact.text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 55)}`;
    const label = fact.text;
    return { page, step, role: fact.kind === 'field' ? 'textbox' : 'button', label,
      route: fact.route ?? routes[0], alt: `Tela de ${module}: ${label}`,
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
  return matches.find((entry) => entry.source === 'upload') ?? matches.find((entry) => entry.source === 'automatic') ?? null;
}

export async function addUploadedScreenshot({ manifest, page, step, file, bytes, alt, label, route, approved, root = outputRoot }) {
  if (approved !== true || !alt || containsSensitiveData(alt)
    || label && containsSensitiveData(label) || route && !routePattern.test(route))
    throw new Error('Upload requer revisão de privacidade');
  const image = checkedPath(page, step);
  const png = bytes ?? await readFile(file);
  if (png.length > 2 * 1024 * 1024 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Upload precisa ser PNG de até 2 MiB');
  const destination = join(root, page, `${step}.png`);
  await mkdir(join(root, page), { recursive: true });
  if (bytes) await writeFile(destination, png);
  else await copyFile(file, destination);
  const previous = chooseScreenshot(manifest, page, step);
  manifest.entries = manifest.entries.filter((entry) => entry.page !== page || entry.step !== step);
  manifest.entries.push({ page, step, label: previous?.label ?? label ?? null, route: previous?.route ?? route ?? null,
    file: image, alt, appSha: null, source: 'upload', masked: ['revisão humana'] });
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function login(page, origin, { email, password }) {
  if (!email || !password) throw new Error('Credenciais de QA ausentes');
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: /e-mail|email/iu }).fill(email);
  await page.getByLabel(/senha|password/iu).fill(password);
  await page.getByRole('button', { name: /^entrar$/iu }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

export async function captureScreens({ baseUrl, plan, storageState, fixture = false,
  manifest = { version: 1, entries: [] }, root = outputRoot, env = process.env }) {
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
    await context.route('**/*', async (route) => {
      const request = new URL(route.request().url());
      if (request.origin !== target.url) return route.abort();
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers().location;
      if (location && new URL(location, request).origin !== target.url) return route.abort();
      return route.fulfill({ response });
    });
    const page = await context.newPage();
    if (!fixture && !storageState) await login(page, target.url, credentialsFromEnv(env).authorized);
    let currentRoute = null;
    let appSha = null;
    for (const step of plan) {
      const uploaded = chooseScreenshot(manifest, step.page, step.step);
      if (uploaded?.source === 'upload') {
        uploaded.label = step.label;
        uploaded.route = step.route;
        continue;
      }
      const image = checkedPath(step.page, step.step);
      if (currentRoute !== step.route) {
        await page.goto(`${target.url}${step.route}`, { waitUntil: 'domcontentloaded' });
        currentRoute = step.route;
        if (!appSha) {
          const bundle = await page.locator('script[src]').evaluateAll((nodes) => nodes.map((node) => node.src)
            .find((url) => new URL(url).origin === location.origin && /\.js(?:\?|$)/u.test(url)) ?? null);
          const content = bundle ? Buffer.from(await (await page.request.get(bundle)).body()) : Buffer.from(await page.content());
          appSha = createHash('sha1').update(content).digest('hex');
        }
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
      const rect = await control.boundingBox();
      if (!rect) throw new Error('Elemento fora da tela');
      const mask = await page.evaluate((allowedLabels) => {
        const areas = [];
        const add = (element, reason) => {
          const r = element.getBoundingClientRect();
          if (r.width && r.height) areas.push({ x: r.x, y: r.y, width: r.width, height: r.height, reason });
        };
        for (const element of document.querySelectorAll('input,textarea,[contenteditable="true"],img,svg,canvas,video,iframe,tbody td')) add(element, 'campo ou conteúdo dinâmico');
        for (const element of document.querySelectorAll('body *')) {
          if (element.children.length || !element.textContent?.trim()) continue;
          if (!allowedLabels.includes(element.textContent.trim())) add(element, 'texto não confirmado');
        }
        return areas;
      }, plan.map((item) => item.label));
      // The shared sensitive-data scanner is the final textual gate. It catches secrets as well as PII.
      const sensitive = await page.evaluate(() => [...document.querySelectorAll('body *')]
        .filter((element) => !element.children.length && element.textContent?.trim())
        .map((element) => ({ text: element.textContent, rect: element.getBoundingClientRect().toJSON() })));
      for (const item of sensitive) if (containsSensitiveData(item.text)) mask.push({ ...item.rect, reason: 'varredura sensível' });
      await page.evaluate(({ masks, rect }) => {
        const privacyStyle = document.createElement('style');
        privacyStyle.setAttribute('data-screen-capture-style', '');
        privacyStyle.textContent = 'body * {background-image:none!important} body *::before,body *::after {content:none!important}';
        document.head.append(privacyStyle);
        const layer = document.createElement('div');
        layer.setAttribute('data-screen-capture-overlay', '');
        layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
        for (const area of masks) {
          const box = document.createElement('div');
          box.style.cssText = `position:absolute;left:${area.x}px;top:${area.y}px;width:${area.width}px;height:${area.height}px;background:#111;`;
          layer.append(box);
        }
        const frame = document.createElement('div');
        frame.style.cssText = `position:absolute;left:${rect.x - 5}px;top:${rect.y - 5}px;width:${rect.width + 10}px;height:${rect.height + 10}px;border:4px solid #ec6400;border-radius:5px;box-sizing:border-box`;
        const arrow = document.createElement('div');
        arrow.textContent = '➜';
        arrow.style.cssText = `position:absolute;left:${Math.max(0, rect.x - 38)}px;top:${Math.max(0, rect.y - 8)}px;color:#ec6400;font:bold 32px sans-serif;text-shadow:0 1px white`;
        layer.append(frame, arrow); document.body.append(layer);
      }, { masks: mask, rect });
      await mkdir(join(root, step.page), { recursive: true });
      await page.screenshot({ path: join(root, step.page, `${step.step}.png`), animations: 'disabled' });
      await page.evaluate(() => {
        document.querySelector('[data-screen-capture-overlay]')?.remove();
        document.querySelector('[data-screen-capture-style]')?.remove();
      });
      if (step.action === 'click' && !isUnsafeCaptureAction(step.label)
        && /^(?:abrir|ver|mostrar|acessar)\b/iu.test(step.label)) await control.click();
      manifest.entries = manifest.entries.filter((entry) => entry.page !== step.page || entry.step !== step.step);
      manifest.entries.push({ page: step.page, step: step.step, label: step.label, route: step.route,
        file: image, alt: step.alt, appSha, source: 'automatic', masked: [...new Set(mask.map((item) => item.reason))] });
    }
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally { await browser.close(); }
}
