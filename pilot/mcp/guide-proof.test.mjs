import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startQaSite } from '../scripts/visual/serve-qa-build.mjs';
import { assertAllowedTarget, runGuideProof } from '../scripts/guide-proof.mjs';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';

assert.throws(() => assertAllowedTarget('https://app.ihelpchat.com'), /recusad|permitid/u);
assert.doesNotThrow(() => assertAllowedTarget('http://127.0.0.1:4173'));
assert.equal(chromeExecutablePath('linux', {}), '/usr/bin/google-chrome');
assert.equal(chromeExecutablePath('darwin', {}), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
assert.equal(chromeExecutablePath('linux', { CHROME_PATH: '/custom/chrome' }), '/custom/chrome');

const root = await mkdtemp(join(tmpdir(), 'guide-proof-r1-'));
const packageRoot = join(root, 'package');
const app = JSON.parse(await readFile(new URL('../public/guides/6fd94ac1700e/app.json', import.meta.url)));
const version = 'fixture';
await mkdir(join(packageRoot, version), { recursive: true });
await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({ current: version }));
await writeFile(join(packageRoot, version, 'app.json'), JSON.stringify(app));
const routes = { channel: ['abrir-canais', 'conectar'], user: ['abrir-usuarios', 'criar-usuario', 'preencher-dados', 'escolher-departamento', 'revisar-acesso', 'salvar-usuario'], department: ['abrir-departamentos', 'configurar-horario', 'escrever-recado', 'salvar-recado'] };
for (const [route, steps] of Object.entries(routes)) {
  const dir = join(root, 'configuracoes', route);
  await mkdir(dir, { recursive: true });
  const controls = steps.map(step => step.startsWith('preencher') || step.startsWith('escrever') || step.startsWith('configurar') || step.startsWith('escolher') || step.startsWith('revisar')
    ? `<input data-proof-step="${step}" />` : `<button data-proof-step="${step}">${step.startsWith('salvar') ? 'Salvar Alterações' : step}</button>`).join('');
  await writeFile(join(dir, 'index.html'), `<!doctype html><html><body>
    <main data-tour-id="guide-${route === 'channel' ? 'qr' : route}-open">${controls.replace(/<button data-proof-step="salvar-[^>]+>Salvar Alterações<\/button>/u, '')}</main>
    ${controls.match(/<button data-proof-step="salvar-[^>]+>Salvar Alterações<\/button>/u)?.[0] ?? ''}
    <script>
      const denied = new URLSearchParams(location.search).get('role') === 'denied';
      const key = 'saved-${route}';
      const field = document.querySelector('input');
      if (field) field.value = localStorage.getItem(key) || '';
      document.querySelectorAll('button').forEach(button => button.onclick = () => {
        if (button.textContent === 'Salvar Alterações' && !denied) localStorage.setItem(key, field.value);
        if (button.textContent !== 'Salvar Alterações') button.dataset.done = 'yes';
      });
    </script></body></html>`);
}
const site = await startQaSite(root, '');
const run = (name) => runGuideProof({ baseUrl: site.url, fixture: true, packageRoot, evidenceDir: join(root, name) });
try {
  await assert.rejects(runGuideProof({ baseUrl: 'https://app.ihelpchat.com', evidenceDir: join(root, 'production') }), /recusad|permitid/u);
  const report = await run('good');
  assert.equal(report.authorized, 'passed');
  assert.equal(report.denied, 'passed');
  assert.ok(report.steps.some(x => x.guideId === 'usuario-acesso' && x.stepId === 'salvar-usuario' && x.status === 'passed'));
  assert.ok(report.steps.some(x => x.stepId === 'ler-codigo' && x.status === 'manual_required'));
  assert.equal(report.guides.length, app.guides.length);
  const user = join(root, 'configuracoes/user/index.html');
  const original = await readFile(user, 'utf8');
  await writeFile(user, original.replace("button.dataset.done = 'yes'", "button.dataset.done = 'no'"));
  await assert.rejects(run('broken-handler'), /ação|concluiu|criar-usuario/u);
  await writeFile(user, original);
  await writeFile(user, original.replace('&& !denied', '&& true'));
  await assert.rejects(run('denied-write'), /negado|alterou/u);
  await writeFile(user, original);
  await writeFile(user, original.replace('data-tour-id="guide-user-open"', 'data-tour-id="removed"'));
  await assert.rejects(run('missing-marker'), /guide-user-open/u);
  await writeFile(user, original);
  app.guides.find(g => g.guideId === 'usuario-acesso').steps.splice(2, 0, { stepId: 'novo-passo', text: 'Clique em Novo passo.' });
  await writeFile(join(packageRoot, version, 'app.json'), JSON.stringify(app));
  await assert.rejects(run('new-step'), /novo-passo/u);
} finally {
  await site.close();
  await rm(root, { recursive: true, force: true });
}
