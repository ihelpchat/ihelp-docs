import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './visual/measure.mjs';
import { envCompatibility } from '../mcp/env-compat.mjs';
import productActions from '../architecture/product-actions.json' with { type: 'json' };

const root = new URL('../public/guides/', import.meta.url);
const scriptsRoot = new URL('./guide-proof/roteiros/', import.meta.url);

const reportFields = {
  mode: value => value === 'staging',
  appSha: (value, expected) => Boolean(expected) && value === expected,
  guides: value => Array.isArray(value) && value.every(item => item && Object.keys(item).every(key => ['id', 'version'].includes(key)) && typeof item.id === 'string' && Number.isInteger(item.version)),
  authorized: value => value === 'passed',
  denied: value => value === 'passed',
  qr: value => value === 'passed' || value === 'manual_required',
  steps: value => Array.isArray(value) && value.every(item => item && Object.keys(item).every(key => ['guideId', 'stepId', 'role', 'status'].includes(key)) && typeof item.guideId === 'string' && typeof item.stepId === 'string' && ['authorized', 'denied'].includes(item.role) && ['passed', 'blocked', 'manual_required'].includes(item.status)),
  screenshots: value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.endsWith('.png')),
  cleanup: value => Array.isArray(value) && value.every(item => item && Object.keys(item).every(key => ['guideId', 'status'].includes(key)) && typeof item.guideId === 'string' && ['restored', 'removed'].includes(item.status)),
  cleanupPending: value => Array.isArray(value) && value.length === 0,
  warning: value => value == null || value === '' || Array.isArray(value) && value.length === 0,
  warnings: value => value == null || Array.isArray(value) && value.length === 0,
  errors: value => value == null || Array.isArray(value) && value.length === 0,
  outcome: value => value == null || value?.ok === true && Array.isArray(value.pending) && value.pending.length === 0,
};
const optionalReportFields = new Set(['warning', 'warnings', 'errors', 'outcome']);

export function proofOutcome(report, { guides, appSha }) {
  const pending = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) return { ok: false, pending: ['relatório ausente ou inválido'] };
  for (const [name, value] of Object.entries(report)) {
    if (!Object.hasOwn(reportFields, name)) pending.push(`${name}: campo desconhecido`);
    else if (!reportFields[name](value, appSha)) pending.push(`${name}: evidência ausente ou pendente`);
  }
  for (const name of Object.keys(reportFields)) {
    if (!optionalReportFields.has(name) && !Object.hasOwn(report, name)) pending.push(`${name}: campo ausente`);
  }
  if (report.mode !== 'staging') pending.push('prova no navegador exige staging');
  if (!appSha || report.appSha !== appSha) pending.push(`SHA da prova divergente de ${appSha}`);
  if (report.authorized !== 'passed') pending.push('perfil authorized não concluído');
  if (report.denied !== 'passed') pending.push('perfil denied não concluído');
  const steps = Array.isArray(report?.steps) ? report.steps : [];
  for (const entry of guides ?? []) {
    const guide = entry.guide ?? entry;
    if (guide.guideId === 'reconectar-canal-qr' && report.qr !== 'passed') pending.push(`${guide.guideId}: qr pendente`);
    if (!Array.isArray(report.guides) || !report.guides.some(item => item?.id === guide.guideId && item.version === guide.version)) pending.push(`${guide.guideId}: guia/versão ausente da prova`);
    for (const { stepId } of guide.steps) {
      const matched = steps.filter(step => step?.guideId === guide.guideId && step.stepId === stepId && step.role === 'authorized');
      if (matched.some(step => step.status === 'manual_required')) pending.push(`${guide.guideId}/${stepId}: manual_required`);
      if (matched.some(step => step.status === 'blocked')) pending.push(`${guide.guideId}/${stepId}: authorized blocked`);
      if (!matched.some(step => step.status === 'passed')) pending.push(`${guide.guideId}/${stepId}: authorized ausente ou não passou`);
      if (matched.some(step => step.status === 'passed') && (!Array.isArray(report.screenshots) || !report.screenshots.includes(`${guide.guideId}-${stepId}.png`))) pending.push(`${guide.guideId}/${stepId}: screenshots ausentes`);
    }
    const denied = steps.filter(step => step?.guideId === guide.guideId && step.role === 'denied');
    if (!denied.some(step => step.status === 'blocked')) pending.push(`${guide.guideId}: bloqueio do perfil denied ausente`);
    for (const step of denied) {
      if (step.status !== 'blocked') pending.push(`${guide.guideId}/${step.stepId}: perfil denied ${step.status}`);
    }
  }
  return { ok: pending.length === 0, pending };
}

export async function publishedGuides(packageRoot = root) {
  const dir = packageRoot instanceof URL ? packageRoot : new URL(`file://${packageRoot}/`);
  const { current } = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
  if (!/^[a-z0-9]{7,12}$/u.test(current)) throw new Error('Manifest de guias inválido');
  const { guides } = JSON.parse(await readFile(new URL(`${current}/app.json`, dir), 'utf8'));
  if (!Array.isArray(guides) || !guides.length) throw new Error('Pacote publicado sem guias');
  return guides;
}

export function assertAllowedTarget(value, env = process.env, { allowProduction = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Destino recusado: URL inválida'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Destino recusado: URL com credencial ou parâmetro');
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  const production = allowProduction && env.QA_TARGET === 'producao';
  let target = { local: false };
  if (production) {
    const hosts = String(env.QA_PROD_ALLOWED_HOSTS ?? '').split(',').map((item) => item.trim());
    if (env.QA_PROD_ENABLED !== 'true' || hosts.length < 1 || hosts.length > 2
      || new Set(hosts).size !== hosts.length || !hosts.includes(url.hostname)
      || hosts.some((host) => host !== url.hostname && !/^api(?:v\d+)?[.-]/u.test(host))
      || !env.QA_PROD_EMAIL || !env.QA_PROD_PASSWORD) throw new Error('Destino recusado: produção desabilitada');
    target = { ...target, mode: 'producao', allowedHosts: hosts };
  }
  const staging = qaRequestDecision(url.href, target, env).allowed;
  if (!local && !staging) throw new Error('Destino recusado: host não permitido');
  if (production && local) throw new Error('Destino recusado: produção exige HTTPS');
  return { ...target, url: url.origin, local };
}

const productionHost = (host) => host === 'ihelpchat.com' || host === 'ihelpchat.com.br'
  || host.endsWith('.ihelpchat.com') || host.endsWith('.ihelpchat.com.br')
  || host === 'api.ihelp.com.br';

export function qaRequestDecision(value, target, env = process.env, { fixtureAllowedOrigins = [] } = {}) {
  let url;
  try { url = new URL(value); } catch { return { allowed: false, host: 'inválido', reason: 'bloqueado: URL inválida' }; }
  const host = url.host;
  if (target.mode === 'producao') {
    const allowed = target.allowedHosts;
    const valid = Array.isArray(allowed) && allowed.length >= 1 && allowed.length <= 2
      && new Set(allowed).size === allowed.length && allowed.includes(new URL(target.url).hostname)
      && allowed.every((item) => /^[a-z0-9.-]+$/u.test(item)
        && (item === new URL(target.url).hostname || /^api(?:v\d+)?[.-]/u.test(item)));
    return { allowed: Boolean(valid && env.QA_TARGET === 'producao' && env.QA_PROD_ENABLED === 'true'
      && url.protocol === 'https:' && !url.port && !url.username
      && !url.password && allowed.includes(url.hostname)), host,
    reason: 'bloqueado: host fora da conta permitida' };
  }
  if (productionHost(url.hostname)) return { allowed: false, host, reason: 'bloqueado: host de produção' };
  if (target.local && url.protocol === 'http:' && url.hostname === '127.0.0.1'
    && (url.origin === target.url || fixtureAllowedOrigins.includes(url.origin))) return { allowed: true, host };
  if (target.local) return { allowed: false, host, reason: 'bloqueado: host fora da lista permitida' };
  const allowed = new Set((env[envCompatibility.guideProof.allowedHosts] ?? '').split(',')
    .map((item) => item.trim()).filter((item) => /^[a-z0-9.-]+$/u.test(item)));
  if (url.protocol === 'https:' && !url.port && !url.username && !url.password && allowed.has(url.hostname))
    return { allowed: true, host };
  return { allowed: false, host, reason: 'bloqueado: host fora da lista permitida' };
}

export async function installQaNetworkGuard(context, target, env = process.env, options = {}) {
  const guard = { blocked: [], reasons: new WeakMap() };
  await context.route('**/*', async (route) => {
    try {
      const request = route.request();
      const decision = qaRequestDecision(request.url(), target, env, options);
      if (!decision.allowed) {
        guard.blocked.push(decision);
        guard.reasons.set(request, decision);
        return await route.abort();
      }
      // route.fetch() waits for the body, so an open event stream times out and
      // is aborted. Fetching first still lets us reject unsafe redirects.
      const streaming = request.resourceType() === 'eventsource' || /\btext\/event-stream\b/iu.test(request.headers().accept ?? '');
      const response = await route.fetch({ maxRedirects: 0, ...(streaming ? { timeout: 1500 } : {}) });
      const location = response.headers().location;
      if (location) {
        const redirected = qaRequestDecision(new URL(location, request.url()).href, target, env, options);
        if (!redirected.allowed) {
          guard.blocked.push(redirected);
          guard.reasons.set(request, redirected);
          return await route.abort();
        }
      }
      await route.fulfill({ response });
    } catch {
      // A route callback must not create an unhandled rejection (Playwright's
      // own error can contain request headers). A closed context needs no abort.
      await route.abort().catch(() => {});
    }
  });
  return guard;
}

export function qaFailedRequest(request, guard) {
  let host = 'inválido';
  try { host = new URL(request.url()).host; } catch { /* no URL is logged */ }
  const blocked = guard?.reasons.get(request);
  if (blocked) host = blocked.host;
  const failure = /^net::[A-Z_]+$/u.test(request.failure()?.errorText ?? '')
    ? request.failure().errorText : 'falha';
  return `${request.method()} ${host} ${blocked ? `${blocked.reason} ` : ''}${failure}`;
}

function safeLoginText(value, secrets) {
  let text = String(value ?? '').replace(/\s+/gu, ' ')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[URL removida]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[e-mail removido]')
    .replace(/\b(?:token|senha|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '[segredo removido]')
    .replace(/\beyJ[A-Za-z0-9_.-]{20,}\b/gu, '[segredo removido]');
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 4)
    text = text.replaceAll(secret, '[segredo removido]');
  return text.slice(0, 200);
}

async function loginControls(page) {
  return page.evaluate(() => [...document.querySelectorAll('input,button,select')]
    .filter((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
    .map((node) => node.labels?.[0]?.textContent?.trim() || node.getAttribute('aria-label')
      || node.tagName === 'BUTTON' && node.textContent?.trim() || node.getAttribute('placeholder') || '')
    .filter(Boolean));
}

export async function loginToQa(page, baseUrl, { email, password }, { timeoutMs = 30000, networkGuard } = {}) {
  if (!email || !password) throw new Error('Credenciais de QA ausentes');
  await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  const before = new Set(await loginControls(page));
  const responses = [];
  const failed = [];
  const origin = new URL(baseUrl).origin;
  const onResponse = (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin !== origin) return;
      responses.push(`${response.request().method()} ${safeLoginText(url.pathname, [email, password])} ${response.status()}`);
    } catch { responses.push('resposta indisponível'); }
  };
  const onFailed = (request) => {
    try { failed.push(qaFailedRequest(request, networkGuard)); }
    catch { failed.push('requisição indisponível'); }
  };
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  const alert = page.locator('[role="alert"]:visible, [class*="toast"]:visible, .error:visible').first();
  let outcome;
  try {
    await page.getByRole('button', { name: /^Entrar$/iu }).click();
    outcome = await Promise.race([
      page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: timeoutMs })
        .then(() => 'navigated').catch(() => 'timeout'),
      alert.waitFor({ state: 'visible', timeout: timeoutMs })
        .then(() => 'alert').catch(() => 'timeout'),
    ]);
    if (outcome === 'navigated') return;
    const path = safeLoginText(new URL(page.url()).pathname, [email, password]);
    const messages = await page.locator('[role="alert"]:visible, [class*="toast"]:visible, .error:visible, form .error:visible, form [aria-live]:visible, form + p:visible')
      .allTextContents();
    const controls = (await loginControls(page)).filter((label) => !before.has(label));
    const diagnostic = { outcome, path, messages: messages.map((message) => safeLoginText(message, [email, password]))
      .filter(Boolean).slice(0, 5), requests: responses.slice(0, 20), failed: failed.slice(0, 20),
    controls: controls.map((label) => safeLoginText(label, [email, password])).slice(0, 10) };
    throw Object.assign(new Error('Login na homologação falhou'), { diagnostic });
  } finally {
    page.off('response', onResponse);
    page.off('requestfailed', onFailed);
  }
}

async function sanitizedScreenshot(page, path) {
  await page.addStyleTag({ content: '#guide-proof-redaction {} * { color: transparent !important; background-image: none !important; text-shadow: none !important; } img,svg,canvas,video,iframe { visibility: hidden !important; } *::before,*::after { content: none !important; }' });
  try { await page.screenshot({ path, fullPage: false }); }
  finally { await page.evaluate(() => [...document.head.querySelectorAll('style')].find(style => style.textContent?.includes('#guide-proof-redaction'))?.remove()); }
}

async function stepPlan(guide, step) {
  if (!/^[a-z0-9-]+$/u.test(guide.guideId)) throw new Error('guideId inválido no pacote publicado');
  const action = step.actionId && productActions[step.actionId];
  const route = action?.route ?? guide.steps.map(item => productActions[item.actionId]?.route).find(Boolean);
  if (!route) throw new Error(`${guide.guideId}/${step.stepId}: rota ausente no catálogo`);
  const script = JSON.parse(await readFile(new URL(`${guide.guideId}.json`, scriptsRoot), 'utf8').catch(() => '{}'));
  const control = script[step.stepId] ?? null;
  return { route, control: control?.source?.file && control?.source?.sha && control?.source?.line ? control : null };
}

function locator(page, control) {
  if (control.nearText) return page.getByText(control.nearText, { exact: true }).locator('..').locator('..').getByRole(control.role);
  const area = control.container ? page.locator(control.container) : page;
  if (control.selector) return area.locator(control.selector);
  return area.getByRole(control.role ?? 'button', { name: control.name, exact: true });
}

async function selectField(page, area, field) {
  const native = area.getByRole('combobox', { name: field.name, exact: true });
  if (await native.count() === 1 && await native.evaluate(el => el.tagName === 'SELECT')) {
    await native.selectOption({ label: field.value });
    return;
  }
  // The app's SelectCommon is a custom combobox with options rendered in a portal.
  const section = area.getByText(field.name, { exact: true }).locator('..');
  if (field.name === 'Departamentos' && await section.getByRole('button').count() === 1) await section.getByRole('button').click();
  const trigger = section.getByRole('combobox');
  if (await trigger.count() !== 1) throw new Error(`select ambíguo: ${field.name}`);
  await trigger.click();
  const option = page.locator('[data-value]').filter({ hasText: field.value });
  if (await option.count() !== 1) throw new Error(`opção ambígua: ${field.value}`);
  await option.click();
}

export async function runGuideProof({ baseUrl, evidenceDir, fixture = false, fixtureLogin = false, credentials, appSha = 'unverified', packageRoot }) {
  const target = assertAllowedTarget(baseUrl);
  if (fixture !== target.local) throw new Error('Destino recusado: modo e host incompatíveis');
  if (!fixture && (!credentials?.authorized?.email || !credentials?.authorized?.password || !credentials?.denied?.email || !credentials?.denied?.password)) {
    throw new Error('pendente: conta de teste de homologação (Bruno)');
  }
  if (packageRoot && !fixture) throw new Error('Pacote alternativo permitido apenas na fixture');
  const published = await publishedGuides(packageRoot);
  const browser = await launch();
  const report = { mode: fixture ? 'fixture' : 'staging', appSha, guides: published.map(({ guideId, version }) => ({ id: guideId, version })),
    authorized: 'pending', denied: 'pending', qr: 'manual_required', steps: [], screenshots: [], cleanup: [], cleanupPending: [] };
  const runId = `qa-guia-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    for (const role of ['authorized', 'denied']) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const networkGuard = await installQaNetworkGuard(context, target);
      const blocked = networkGuard.blocked;
      const page = await context.newPage();
      try {
        if (!fixture || fixtureLogin) await loginToQa(page, target.url, credentials[role], { networkGuard });
        for (const guide of published) {
          const plans = await Promise.all(guide.steps.map(step => stepPlan(guide, step)));
          const initial = plans[0].route;
          await page.goto(`${target.url}${initial}${fixture && role === 'denied' ? '?role=denied' : ''}`, { waitUntil: 'domcontentloaded' });
          const filled = new Map();
          const original = new Map();
          const changed = new Map();
          let created = null;
          let deniedBlocked = false;
          try {
          for (let index = 0; index < guide.steps.length; index++) {
            const step = guide.steps[index];
            const plan = plans[index];
            if (!plan.control) {
              if (role === 'authorized') report.steps.push({ guideId: guide.guideId, stepId: step.stepId, role, status: 'manual_required' });
              continue;
            }
            // Only a published catalog route may change the current URL.
            const current = new URL(page.url());
            if (blocked.length || current.origin !== target.url) throw new Error(`${guide.guideId}: navegação fora do host autorizado`);
            if (plan.control.marker) {
              const marker = page.locator(`[data-tour-id="${plan.control.marker}"], [data-help-id="${plan.control.marker}"]`);
              await marker.waitFor({ state: 'visible', timeout: 5000 });
              if (await marker.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: marcador ausente ${plan.control.marker}`);
            }
            const instruction = plan.control;
            if (role === 'denied' && deniedBlocked) continue;
            if (instruction.enter) {
              const entry = locator(page, instruction.enter);
              if (await entry.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: entrada ambígua`);
              await entry.click();
              await page.waitForURL(new RegExp(instruction.enter.path));
              const entered = new URL(page.url());
              if (entered.origin !== target.url || !entered.pathname.startsWith(`${plan.route}/`)) throw new Error(`${guide.guideId}: detalhe fora da rota publicada`);
            }
            const control = instruction.type === 'fields' ? null : locator(page, instruction);
            if (role === 'denied' && control && !(await control.isEnabled())) {
              deniedBlocked = true;
              report.steps.push({ guideId: guide.guideId, stepId: step.stepId, role, status: 'blocked' });
              continue;
            }
            if (control) {
              await control.waitFor({ state: 'visible', timeout: 5000 });
              if (await control.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: controle ambíguo ${instruction.name}`);
            }
            if (instruction.type === 'fields') {
              if (instruction.verifySelector && !original.has(step.stepId)) original.set(step.stepId, await page.locator(instruction.verifySelector).textContent() ?? '');
              if (instruction.enable) {
                const toggle = locator(page, instruction.enable);
                if (await toggle.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: toggle ambíguo`);
                if (!changed.has('toggle')) changed.set('toggle', await toggle.isChecked());
                if (!(await page.locator(instruction.fields[0].selector).isVisible())) await toggle.click();
              }
              const area = instruction.container ? page.locator(instruction.container) : page;
              if (instruction.container && await area.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: container ambíguo`);
              for (const field of instruction.fields) {
                const value = field.value.replaceAll('${runId}', runId);
                if (field.type === 'select') {
                  const native = area.getByRole('combobox', { name: field.name, exact: true });
                  if (!changed.has(field.name)) changed.set(field.name, await native.count() === 1 && await native.evaluate(el => el.tagName === 'SELECT') ? await native.inputValue() : await area.getByText(field.name, { exact: true }).locator('..').getByRole('combobox').textContent());
                  await selectField(page, area, field);
                } else {
                  const input = field.selector ? area.locator(field.selector) : area.getByRole('textbox', { name: field.name, exact: true });
                  if (await input.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: campo ambíguo`);
                  if (!changed.has(field.selector ?? field.name)) changed.set(field.selector ?? field.name, await input.inputValue());
                  if (!original.has(step.stepId)) original.set(step.stepId, await input.inputValue());
                  await input.fill(value);
                }
                if (!filled.has(step.stepId)) filled.set(step.stepId, value);
              }
              if (instruction.commit) await locator(page, instruction.commit).click();
            } else if (instruction.type === 'save') {
              const fieldStep = instruction.verifyField;
              const fieldIndex = guide.steps.findIndex(item => item.stepId === fieldStep);
              if (!filled.has(fieldStep) || fieldIndex < 0) {
                if (role === 'authorized') report.steps.push({ guideId: guide.guideId, stepId: step.stepId, role, status: 'manual_required' });
                continue;
              }
              const source = plans[fieldIndex].control;
              const firstField = source.fields[0];
              const field = source.verifySelector ? page.locator(source.verifySelector) : locator(page, { container: source.container, selector: firstField.selector, role: 'textbox', name: firstField.name });
              const readField = async () => source.verifySelector ? (await field.count() ? field.textContent() : '') : field.inputValue();
              const candidate = filled.get(fieldStep);
              const before = original.get(fieldStep);
              await control.click({ timeout: 3000 });
              if (guide.guideId === 'usuario-acesso') {
                created = candidate;
                await page.reload({ waitUntil: 'domcontentloaded' });
                const item = fixture ? page.locator(`[data-proof-item="${candidate}"]`) : page.getByText(candidate, { exact: false });
                const exists = await item.count() > 0;
                if (role === 'authorized' && !exists) throw new Error(`${guide.guideId}/${step.stepId}: gravação não persistiu`);
                if (role === 'denied' && exists) throw new Error(`${guide.guideId}/${step.stepId}: perfil negado alterou dados`);
              } else {
                await page.reload({ waitUntil: 'domcontentloaded' });
                const after = await readField();
                if (role === 'authorized' && after !== candidate) throw new Error(`${guide.guideId}/${step.stepId}: gravação não persistiu`);
                if (role === 'denied' && after !== before) throw new Error(`${guide.guideId}/${step.stepId}: perfil negado alterou dados`);
              if (role === 'authorized') {
                  const toggle = source.enable ? locator(page, source.enable) : null;
                  try {
                  // DepartmentConfigExtras clears the message when toggled (lines 356-364);
                  // ChatView ignores an empty send (lines 210-224).
                  if (toggle && source.verifySelector && before === '') {
                    await toggle.click();
                    if (changed.get('toggle')) await toggle.click();
                  } else if (toggle && await toggle.isChecked() !== changed.get('toggle')) await toggle.click();
                  for (const prior of plans.filter(item => item.control?.type === 'fields')) {
                    for (const changedField of prior.control.fields) {
                      if (changedField.type === 'select') continue;
                      const selector = changedField.selector;
                      const input = page.locator(selector);
                      if (await input.isVisible()) await input.fill(prior.control.verifySelector ? before : changed.get(selector));
                    }
                    if (prior.control.commit && (prior.control.verifySelector ? before : changed.get(prior.control.fields[0].selector)) !== '' && await page.locator(prior.control.fields[0].selector).isVisible()) await locator(page, prior.control.commit).click();
                  }
                  await locator(page, instruction).click();
                  await page.reload({ waitUntil: 'domcontentloaded' });
                  if (await readField() !== before) throw new Error(`${guide.guideId}/${step.stepId}: restauração não persistiu`);
                  if (toggle && await toggle.isChecked() !== changed.get('toggle')) throw new Error(`${guide.guideId}/${step.stepId}: toggle não restaurado`);
                  for (const prior of plans.filter(item => item.control?.type === 'fields')) {
                    for (const changedField of prior.control.fields) {
                      if (changedField.type === 'select') continue;
                      const input = page.locator(changedField.selector);
                      if (await input.isVisible() && await input.inputValue() !== changed.get(changedField.selector)) throw new Error(`${guide.guideId}/${step.stepId}: campo não restaurado ${changedField.selector}`);
                    }
                  }
                  report.cleanup.push({ guideId: guide.guideId, status: 'restored' });
                  } catch (error) {
                    if (guide.guideId !== 'recado-fora-do-horario') throw error;
                    report.cleanupPending.push({ guideId: guide.guideId, reason: error.message });
                    report.warning = 'limpeza pendente';
                  }
                }
              }
            } else {
              if (role === 'authorized' && !(await control.isEnabled())) throw new Error(`${guide.guideId}/${step.stepId}: perfil autorizado bloqueado`);
              const before = role === 'authorized' && !fixture ? await page.locator('body').innerHTML() : null;
              await control.click({ timeout: 3000 });
              if (before !== null && await page.locator('body').innerHTML() === before) throw new Error(`${guide.guideId}/${step.stepId}: ação web não concluiu`);
              if (fixture && role === 'authorized' && step.stepId !== 'criar-usuario' && await control.getAttribute('data-done') !== 'yes') throw new Error(`${guide.guideId}/${step.stepId}: ação web não concluiu`);
            }
            if (blocked.length) throw new Error(`${guide.guideId}: pedido fora do host autorizado`);
            if (role === 'authorized') {
              report.steps.push({ guideId: guide.guideId, stepId: step.stepId, role, status: 'passed' });
              await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
              await chmod(evidenceDir, 0o700);
              const name = `${guide.guideId}-${step.stepId}.png`;
              await sanitizedScreenshot(page, join(evidenceDir, name));
              await chmod(join(evidenceDir, name), 0o600);
              report.screenshots.push(name);
            }
          }
          if (role === 'denied') {
            const saves = page.getByRole('button', { name: /Salvar/u });
            const count = await saves.count();
            for (let saveIndex = 0; saveIndex < count; saveIndex++) {
              await page.reload({ waitUntil: 'domcontentloaded' });
              const before = await page.locator('body').innerHTML();
              const save = saves.nth(saveIndex);
              if (await save.isEnabled()) await save.click({ timeout: 3000 });
              await page.reload({ waitUntil: 'domcontentloaded' });
              if (await page.locator('body').innerHTML() !== before) throw new Error(`${guide.guideId}: perfil negado alterou dados`);
            }
          }
          } finally {
          if (role === 'authorized' && created) {
            // A created user must be removed through the UI, then checked after reload.
            try {
              const row = fixture ? page.locator(`[data-proof-item="${created}"]`) : page.getByText(created, { exact: true }).locator('xpath=ancestor::tr[1]');
              if (await row.count() !== 1) throw new Error('item criado não encontrado');
              if (fixture) await row.getByRole('button', { name: /Excluir|Remover/u }).click({ timeout: 3000 });
              else {
                await row.locator('a[title="Excluir"], [title="Excluir"] a').click({ timeout: 3000 });
                await page.getByRole('button', { name: /Confirmar|Sim|Excluir/u }).click({ timeout: 3000 });
              }
              await page.reload({ waitUntil: 'domcontentloaded' });
              if (await (fixture ? page.locator(`[data-proof-item="${created}"]`) : page.getByText(created, { exact: false })).count()) throw new Error('item criado ainda aparece');
              report.cleanup.push({ guideId: guide.guideId, status: 'removed' });
            } catch (error) {
              report.cleanupPending.push({ guideId: guide.guideId, item: created, reason: error.message });
            }
          }
          }
        }
        report[role] = 'passed';
      } finally { await context.close(); }
    }
    if (report.cleanupPending.some(item => item.item)) throw new Error('limpeza pendente: item criado não removido pela interface');
    return report;
  } finally {
    report.outcome = proofOutcome(report, { guides: published, appSha });
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
    await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    await browser.close();
  }
}

export function credentialsFromEnv(env = process.env) {
  const names = envCompatibility.guideProof;
  return {
    authorized: { email: env[names.authorizedEmail], password: env[names.authorizedPassword] },
    denied: { email: env[names.deniedEmail], password: env[names.deniedPassword] },
  };
}
