import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startQaSite } from '../scripts/visual/serve-qa-build.mjs';
import { runGuideProof } from '../scripts/guide-proof.mjs';
import { chromeExecutablePath } from '../scripts/visual/measure.mjs';

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
const routes = ['channel', 'user', 'department'];
for (const route of routes) {
  const dir = join(root, 'configuracoes', route);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), `<!doctype html><html><body>
    <main data-tour-id="guide-${route === 'channel' ? 'qr' : route === 'department' ? 'department' : 'user'}-open">
      <button data-proof-step="${route === 'channel' ? 'abrir-canais' : route === 'user' ? 'abrir-usuarios' : 'abrir-departamentos'}">Abrir</button>
      <button data-proof-step="${route === 'channel' ? 'conectar' : route === 'user' ? 'criar-usuario' : 'configurar-horario'}">Continuar</button>
      <input data-proof-step="${route === 'user' ? 'preencher-dados' : 'escrever-recado'}" />
    </main><button data-proof-step="${route === 'user' ? 'salvar-usuario' : 'salvar-recado'}">Salvar Alterações</button>
    <script>
      const denied = new URLSearchParams(location.search).get('role') === 'denied';
      const key = 'saved-${route}';
      document.querySelector('input').value = localStorage.getItem(key) || '';
      document.querySelectorAll('button').forEach(button => button.onclick = () => {
        if (button.textContent === 'Salvar Alterações' && !denied) localStorage.setItem(key, document.querySelector('input').value);
        if (button.textContent !== 'Salvar Alterações') button.dataset.done = 'yes';
      });
    </script></body></html>`);
}
const site = await startQaSite(root, '');
const run = (name) => runGuideProof({ baseUrl: site.url, fixture: true, packageRoot, evidenceDir: join(root, name) });
try {
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
  await writeFile(user, original.replace('if (!denied)', 'if (true)'));
  await assert.rejects(run('denied-write'), /negado|alterou/u);
  await writeFile(user, original);
  app.guides.find(g => g.guideId === 'usuario-acesso').steps.splice(2, 0, { stepId: 'novo-passo', text: 'Clique em Novo passo.' });
  await writeFile(join(packageRoot, version, 'app.json'), JSON.stringify(app));
  await assert.rejects(run('new-step'), /novo-passo/u);
} finally {
  await site.close();
  await rm(root, { recursive: true, force: true });
}
