import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './visual/measure.mjs';
import { parseArticle } from '../mcp/editorial-standard.mjs';
import { envCompatibility } from '../mcp/env-compat.mjs';

const guideFiles = [
  ['reconectar-canal-qr', 'content/docs/docs/principais-motivos-de-suporte/reconectar-canal-qr.mdx', '/configuracoes/channel', 'guide-qr-open'],
  ['usuario-acesso', 'content/docs/docs/principais-motivos-de-suporte/usuario-acesso.mdx', '/configuracoes/user', 'guide-user-open'],
  ['recado-fora-do-horario', 'content/docs/docs/sobre-o-sistema/configuracoes/departamentos/recado-fora-do-horario.mdx', '/configuracoes/department', 'guide-department-open'],
];

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

async function guides() {
  const root = new URL('../', import.meta.url);
  return Promise.all(guideFiles.map(async ([id, path, route, marker]) => {
    const raw = await readFile(new URL(path, root), 'utf8');
    const { metadata } = parseArticle(raw, path);
    if (metadata.guide.guideId !== id) throw new Error(`${id}: guia publicado divergente`);
    return { id, route, marker, version: metadata.guide.version, steps: metadata.guide.steps.map(({ stepId }) => stepId) };
  }));
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

export async function runGuideProof({ baseUrl, evidenceDir, fixture = false, credentials, appSha = 'unverified' }) {
  const target = assertAllowedTarget(baseUrl); // Must run before launch or any file write.
  if (fixture !== target.local) throw new Error('Destino recusado: modo e host incompatíveis');
  if (!fixture && (!credentials?.authorized?.email || !credentials?.authorized?.password || !credentials?.denied?.email || !credentials?.denied?.password)) {
    throw new Error('pendente: conta de teste de homologação (Bruno)');
  }
  const published = await guides();
  const browser = await launch();
  const report = { mode: fixture ? 'fixture' : 'staging', appSha, guides: published.map(({ id, version }) => ({ id, version })),
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
          const path = `${guide.route}${fixture && role === 'denied' ? '?role=denied' : ''}`;
          await page.goto(`${target.url}${path}`, { waitUntil: 'domcontentloaded' });
          const current = new URL(page.url());
          if (current.origin !== target.url || current.pathname !== guide.route) throw new Error(`${guide.id}: navegação fora do app autorizado`);
          const marker = page.locator(`[data-tour-id="${guide.marker}"], [data-help-id="${guide.marker}"]`);
          if (await marker.count() !== 1) throw new Error(`${guide.id}: marcador ausente ${guide.marker}`);
          const button = (await marker.evaluate((element) => element instanceof HTMLButtonElement)) ? marker : marker.locator('button').first();
          if (await button.count() !== 1) throw new Error(`${guide.id}: controle web ausente`);
          if (role === 'authorized') {
            if (!(await button.isEnabled())) throw new Error(`${guide.id}: perfil autorizado bloqueado`);
            if (fixture) {
              await button.click();
              const writes = await page.evaluate(() => window.fixtureWrites);
              if (writes !== 1) throw new Error(`${guide.id}: ação web não concluiu`);
            }
            report.steps.push({ guideId: guide.id, stepId: guide.steps[0], status: fixture ? 'passed' : 'marker_verified' });
            if (guide.id === 'reconectar-canal-qr') report.steps.push({ guideId: guide.id, stepId: 'ler-codigo', status: 'manual_required' });
            await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
            await chmod(evidenceDir, 0o700);
            const name = `${guide.id}.png`;
            await sanitizedScreenshot(page, join(evidenceDir, name));
            await chmod(join(evidenceDir, name), 0o600);
            report.screenshots.push(name);
          } else {
            if (await button.isEnabled()) throw new Error(`${guide.id}: perfil negado pode alterar dados`);
            if (fixture && await page.evaluate(() => window.fixtureWrites) !== 0) throw new Error(`${guide.id}: perfil negado alterou dados`);
          }
        }
        report[role] = fixture ? 'passed' : role === 'authorized' ? 'marker_verified' : 'control_disabled';
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
