import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './visual/measure.mjs';
import { envCompatibility } from '../mcp/env-compat.mjs';
import productActions from '../architecture/product-actions.json' with { type: 'json' };

// Selectors are evidence adapters for the current product UI. Every published step is
// enumerated from app.json; an unmapped new web step fails closed.
const controls = {
  'reconectar-canal-qr': { 'abrir-canais': ['click', 'guide-qr-open'], conectar: ['click', 'Conectar'] },
  'usuario-acesso': { 'abrir-usuarios': ['click', 'guide-user-open'], 'criar-usuario': ['click', 'Novo usuário'], 'preencher-dados': ['fill', 'Nome'], 'escolher-departamento': ['fill', 'Departamentos'], 'revisar-acesso': ['fill', 'Acesso'], 'salvar-usuario': ['save', 'Salvar Alterações'] },
  'recado-fora-do-horario': { 'abrir-departamentos': ['click', 'guide-department-open'], 'configurar-horario': ['fill', 'Horário'], 'escrever-recado': ['fill', 'Mensagem automática fora de horário de atendimento'], 'salvar-recado': ['save', 'Salvar Alterações'] },
};
const manual = new Set(['escolher-celular', 'android', 'iphone', 'ler-codigo', 'sem-celular', 'pedir-ajuda']);
const root = new URL('../public/guides/', import.meta.url);

export async function publishedGuides(packageRoot = root) {
  const dir = packageRoot instanceof URL ? packageRoot : new URL(`file://${packageRoot}/`);
  const { current } = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
  if (!/^[a-z0-9]{7,12}$/u.test(current)) throw new Error('Manifest de guias inválido');
  const { guides } = JSON.parse(await readFile(new URL(`${current}/app.json`, dir), 'utf8'));
  if (!Array.isArray(guides) || !guides.length) throw new Error('Pacote publicado sem guias');
  return guides;
}

export function assertAllowedTarget(value, env = process.env) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Destino recusado: URL inválida'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Destino recusado: URL com credencial ou parâmetro');
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
  const allowed = new Set((env[envCompatibility.guideProof.allowedHosts] ?? '').split(',').map((host) => host.trim()).filter(Boolean));
  const stagingName = /^(?:staging|homolog|homologacao)(?:-[a-z0-9]+)?\.ihelpchat\.com(?:\.br)?$/u.test(url.hostname);
  const staging = url.protocol === 'https:' && stagingName && allowed.has(url.hostname) && !url.port;
  if (!local && !staging) throw new Error('Destino recusado: host não permitido');
  return { url: url.origin, local };
}

async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /^Entrar$/u }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10000 });
}

async function sanitizedScreenshot(page, path) {
  await page.addStyleTag({ content: '#guide-proof-redaction {} * { color: transparent !important; background-image: none !important; text-shadow: none !important; } img,svg,canvas,video,iframe { visibility: hidden !important; } *::before,*::after { content: none !important; }' });
  try { await page.screenshot({ path, fullPage: false }); }
  finally { await page.evaluate(() => [...document.head.querySelectorAll('style')].find(style => style.textContent?.includes('#guide-proof-redaction'))?.remove()); }
}

function stepPlan(guide, step) {
  const action = step.actionId && productActions[step.actionId];
  const route = action?.route ?? guide.steps.map(item => productActions[item.actionId]?.route).find(Boolean);
  if (!route) throw new Error(`${guide.guideId}/${step.stepId}: rota ausente no catálogo`);
  const control = controls[guide.guideId]?.[step.stepId];
  if (!control && !manual.has(step.stepId)) throw new Error(`${guide.guideId}/${step.stepId}: ação web sem alvo no catálogo`);
  return { route, control, marker: control?.[1]?.startsWith('guide-') ? control[1] : undefined };
}

function locator(page, step, plan, fixture) {
  if (fixture) return page.locator(`[data-proof-step="${step.stepId}"]`);
  if (plan.marker) return page.locator(`[data-tour-id="${plan.marker}"] button, [data-help-id="${plan.marker}"] button, button[data-tour-id="${plan.marker}"], button[data-help-id="${plan.marker}"]`).first();
  const [type, label] = plan.control;
  return type === 'fill' ? page.getByLabel(label, { exact: false }) : page.getByRole('button', { name: label, exact: false });
}

export async function runGuideProof({ baseUrl, evidenceDir, fixture = false, credentials, appSha = 'unverified', packageRoot }) {
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
      const context = await browser.newContext();
      await context.route('**/*', (route) => {
        if (route.request().isNavigationRequest() && new URL(route.request().url()).origin !== target.url) return route.abort();
        return route.continue();
      });
      const page = await context.newPage();
      try {
        if (!fixture) await login(page, target.url, credentials[role].email, credentials[role].password);
        for (const guide of published) {
          const plans = guide.steps.map(step => stepPlan(guide, step));
          const initial = plans[0].route;
          await page.goto(`${target.url}${initial}${fixture && role === 'denied' ? '?role=denied' : ''}`, { waitUntil: 'domcontentloaded' });
          const filled = new Map();
          const original = new Map();
          let created = null;
          try {
          for (let index = 0; index < guide.steps.length; index++) {
            const step = guide.steps[index];
            const plan = plans[index];
            if (!plan.control) {
              if (role === 'authorized') report.steps.push({ guideId: guide.guideId, stepId: step.stepId, status: 'manual_required' });
              continue;
            }
            // Only a published catalog route may change the current URL.
            if (step.actionId && new URL(page.url()).pathname !== plan.route) {
              await page.goto(`${target.url}${plan.route}${fixture && role === 'denied' ? '?role=denied' : ''}`, { waitUntil: 'domcontentloaded' });
            }
            const current = new URL(page.url());
            if (current.origin !== target.url || current.pathname !== plan.route) throw new Error(`${guide.guideId}: navegação fora do app autorizado`);
            if (plan.marker) {
              const marker = page.locator(`[data-tour-id="${plan.marker}"], [data-help-id="${plan.marker}"]`);
              await marker.waitFor({ state: 'visible', timeout: 5000 });
              if (await marker.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: marcador ausente ${plan.marker}`);
            }
            const control = locator(page, step, plan, fixture);
            await control.waitFor({ state: 'visible', timeout: 5000 });
            if (await control.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: controle ambíguo ${plan.control[1]}`);
            const [type] = plan.control;
            if (type === 'fill') {
              original.set(step.stepId, await control.inputValue());
              const value = step.stepId === 'preencher-dados' ? runId : `${runId}-${step.stepId}`;
              await control.fill(value);
              filled.set(step.stepId, value);
            } else if (type === 'save') {
              const fieldStep = guide.guideId === 'usuario-acesso' ? 'preencher-dados' : 'escrever-recado';
              const fieldIndex = guide.steps.findIndex(item => item.stepId === fieldStep);
              if (!filled.has(fieldStep) || fieldIndex < 0) {
                if (role === 'authorized') report.steps.push({ guideId: guide.guideId, stepId: step.stepId, status: 'manual_required' });
                continue;
              }
              const field = locator(page, guide.steps[fieldIndex], plans[fieldIndex], fixture);
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
                const after = await field.inputValue();
                if (role === 'authorized' && after !== candidate) throw new Error(`${guide.guideId}/${step.stepId}: gravação não persistiu`);
                if (role === 'denied' && after !== before) throw new Error(`${guide.guideId}/${step.stepId}: perfil negado alterou dados`);
                if (role === 'authorized') {
                  await field.fill(before);
                  await locator(page, step, plan, fixture).click();
                  await page.reload({ waitUntil: 'domcontentloaded' });
                  if (await field.inputValue() !== before) throw new Error(`${guide.guideId}/${step.stepId}: restauração não persistiu`);
                  report.cleanup.push({ guideId: guide.guideId, status: 'restored' });
                }
              }
            } else {
              if (role === 'authorized' && !(await control.isEnabled())) throw new Error(`${guide.guideId}/${step.stepId}: perfil autorizado bloqueado`);
              const before = role === 'authorized' && !fixture ? await page.locator('body').innerHTML() : null;
              await control.click({ timeout: 3000 });
              if (before !== null && await page.locator('body').innerHTML() === before) throw new Error(`${guide.guideId}/${step.stepId}: ação web não concluiu`);
              if (fixture && role === 'authorized' && await control.getAttribute('data-done') !== 'yes') throw new Error(`${guide.guideId}/${step.stepId}: ação web não concluiu`);
            }
            if (role === 'authorized') {
              report.steps.push({ guideId: guide.guideId, stepId: step.stepId, status: 'passed' });
              await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
              await chmod(evidenceDir, 0o700);
              const name = `${guide.guideId}-${step.stepId}.png`;
              await sanitizedScreenshot(page, join(evidenceDir, name));
              await chmod(join(evidenceDir, name), 0o600);
              report.screenshots.push(name);
            }
          }
          } finally {
          if (role === 'authorized' && created) {
            // A created user must be removed through the UI, then checked after reload.
            try {
              const row = fixture ? page.locator(`[data-proof-item="${created}"]`) : page.getByText(created, { exact: true }).locator('..');
              if (await row.count() !== 1) throw new Error('item criado não encontrado');
              await row.getByRole('button', { name: /Excluir|Remover/u }).click({ timeout: 3000 });
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
    if (report.cleanupPending.length) throw new Error('limpeza pendente: item criado não removido pela interface');
    return report;
  } finally {
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
