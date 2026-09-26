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
  await page.evaluate(() => {
    document.querySelectorAll('input,textarea').forEach((element) => { element.value = ''; element.setAttribute('placeholder', ''); });
    document.querySelectorAll('img,svg,canvas,video,iframe').forEach((element) => element.remove());
    const style = document.createElement('style');
    style.textContent = '* { background-image: none !important; } *::before, *::after { content: none !important; }';
    document.head.append(style);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) walker.currentNode.textContent = '▇';
  });
  await page.screenshot({ path, fullPage: false });
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
  return type === 'fill' ? page.getByLabel(label, { exact: false }).first() : page.getByRole('button', { name: label, exact: false }).first();
}

async function readValue(control) { return control.inputValue(); }

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
    authorized: 'pending', denied: 'pending', qr: 'manual_required', steps: [], screenshots: [] };
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
          for (const step of guide.steps) {
            const plan = stepPlan(guide, step);
            if (!plan.control) {
              if (role === 'authorized') report.steps.push({ guideId: guide.guideId, stepId: step.stepId, status: 'manual_required' });
              continue;
            }
            const path = `${plan.route}${fixture && role === 'denied' ? '?role=denied' : ''}`;
            await page.goto(`${target.url}${path}`, { waitUntil: 'domcontentloaded' });
            const current = new URL(page.url());
            if (current.origin !== target.url || current.pathname !== plan.route) throw new Error(`${guide.guideId}: navegação fora do app autorizado`);
            if (plan.marker && await page.locator(`[data-tour-id="${plan.marker}"], [data-help-id="${plan.marker}"]`).count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: marcador ausente ${plan.marker}`);
            const control = locator(page, step, plan, fixture);
            if (await control.count() !== 1) throw new Error(`${guide.guideId}/${step.stepId}: marcador ou controle ausente ${plan.marker ?? plan.control[1]}`);
            const [type] = plan.control;
            if (type === 'fill') {
              if (role === 'authorized') await control.fill(`Prova ${step.stepId}`);
              else await control.fill(`Negado ${step.stepId}`).catch(() => {});
            } else if (type === 'save') {
              const field = fixture ? page.locator('input').first() : page.getByRole('textbox').first();
              const before = await readValue(field);
              const candidate = role === 'authorized' ? `Prova ${guide.guideId}` : `Negado ${guide.guideId}`;
              await field.fill(candidate).catch(() => {});
              await control.click({ force: true, timeout: 3000 }).catch(() => {});
              await page.reload({ waitUntil: 'domcontentloaded' });
              const after = await readValue(fixture ? page.locator('input').first() : page.getByRole('textbox').first());
              if (role === 'authorized' && after !== candidate) throw new Error(`${guide.guideId}/${step.stepId}: gravação não persistiu`);
              if (role === 'denied' && after !== before) throw new Error(`${guide.guideId}/${step.stepId}: perfil negado alterou dados`);
              if (role === 'authorized') {
                await (fixture ? page.locator('input').first() : page.getByRole('textbox').first()).fill(before);
                await locator(page, step, plan, fixture).click();
              }
            } else {
              if (role === 'authorized' && !(await control.isEnabled())) throw new Error(`${guide.guideId}/${step.stepId}: perfil autorizado bloqueado`);
              const before = role === 'authorized' && !fixture ? await page.locator('body').innerHTML() : null;
              await control.click({ force: true, timeout: 3000 }).catch(() => {});
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
        }
        report[role] = 'passed';
      } finally { await context.close(); }
    }
    await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  } finally { await browser.close(); }
}

export function credentialsFromEnv(env = process.env) {
  const names = envCompatibility.guideProof;
  return {
    authorized: { email: env[names.authorizedEmail], password: env[names.authorizedPassword] },
    denied: { email: env[names.deniedEmail], password: env[names.deniedPassword] },
  };
}
