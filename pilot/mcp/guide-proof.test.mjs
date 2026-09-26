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

const root = await mkdtemp(join(tmpdir(), 'guide-proof-r2-'));
const packageRoot = join(root, 'package');
const app = JSON.parse(await readFile(new URL('../public/guides/6fd94ac1700e/app.json', import.meta.url)));
await mkdir(join(packageRoot, 'fixture'), { recursive: true });
await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({ current: 'fixture' }));
await writeFile(join(packageRoot, 'fixture', 'app.json'), JSON.stringify(app));
const routes = {
  channel: `<main data-tour-id="guide-qr-open"><button data-proof-step="abrir-canais">Canais</button><button data-proof-step="conectar">Conectar</button></main>`,
  user: `<main data-tour-id="guide-user-open"><button data-proof-step="abrir-usuarios">Usuários</button><button data-proof-step="criar-usuario" onclick="document.querySelector('#form').hidden=false">Novo usuário</button><input aria-label="Campo alheio" value="intocado"><section id="form" hidden><input data-proof-step="preencher-dados" aria-label="Nome"><input data-proof-step="escolher-departamento" aria-label="Departamentos"><input data-proof-step="revisar-acesso" aria-label="Acesso"><button data-proof-step="salvar-usuario">Salvar Alterações</button></section><ul id="items"></ul></main>`,
  department: `<main data-tour-id="guide-department-open"><button data-proof-step="abrir-departamentos">Departamentos</button><input aria-label="Campo alheio" value="intocado"><input data-proof-step="configurar-horario" aria-label="Horário"><input data-proof-step="escrever-recado" aria-label="Mensagem automática fora de horário de atendimento"><button data-proof-step="salvar-recado">Salvar Alterações</button></main>`,
};
for (const [route, html] of Object.entries(routes)) {
  const dir = join(root, 'configuracoes', route);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), `<!doctype html><html><body>${html}<script>
    const denied = new URLSearchParams(location.search).get('role') === 'denied';
    const key = 'saved-${route}';
    const input = document.querySelector('[data-proof-step="${route === 'user' ? 'preencher-dados' : 'escrever-recado'}"]');
    const items = document.querySelector('#items');
    function render() { if (items) items.innerHTML = JSON.parse(localStorage.getItem(key) || '[]').map(name => '<li data-proof-item="' + name + '">' + name + '<button>Excluir</button></li>').join(''); else if (input) input.value = localStorage.getItem(key) || ''; }
    render();
    document.body.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.textContent === 'Excluir') { if (!denied) { const name = button.closest('li').dataset.proofItem; localStorage.setItem(key, JSON.stringify(JSON.parse(localStorage.getItem(key) || '[]').filter(x => x !== name))); render(); } return; }
      if (button.textContent === 'Salvar Alterações') { if (!denied) { if (items) { const list = JSON.parse(localStorage.getItem(key) || '[]'); list.push(input.value); localStorage.setItem(key, JSON.stringify(list)); render(); } else localStorage.setItem(key, input.value); } return; }
      button.dataset.done = 'yes';
    });
  </script></body></html>`);
}
const site = await startQaSite(root, '');
const run = name => runGuideProof({ baseUrl: site.url, fixture: true, packageRoot, evidenceDir: join(root, name) });
try {
  await assert.rejects(runGuideProof({ baseUrl: 'https://app.ihelpchat.com', evidenceDir: join(root, 'production') }), /recusad|permitid/u);
  const report = await run('good');
  assert.equal(report.authorized, 'passed');
  assert.equal(report.denied, 'passed');
  assert.equal(report.cleanupPending.length, 0);
  assert.ok(report.cleanup.some(x => x.guideId === 'usuario-acesso' && x.status === 'removed'));
  assert.ok(report.steps.some(x => x.guideId === 'usuario-acesso' && x.stepId === 'salvar-usuario' && x.status === 'passed'));
  assert.ok(report.steps.some(x => x.stepId === 'ler-codigo' && x.status === 'manual_required'));
  assert.equal(report.guides.length, app.guides.length);
  const user = join(root, 'configuracoes/user/index.html');
  const original = await readFile(user, 'utf8');
  await writeFile(user, original.replace("button.dataset.done = 'yes'", "button.dataset.done = 'no'"));
  await assert.rejects(run('broken-handler'), /ação|concluiu|criar-usuario/u);
  await writeFile(user, original.replace('if (!denied)', 'if (true)'));
  await assert.rejects(run('denied-write'), /negado|alterou/u);
  await writeFile(user, original.replace('data-tour-id="guide-user-open"', 'data-tour-id="removed"'));
  await assert.rejects(run('missing-marker'), /guide-user-open/u);
  await writeFile(user, original.replace("localStorage.setItem(key, JSON.stringify(JSON.parse(localStorage.getItem(key) || '[]').filter(x => x !== name)));", '/* deletion disabled */'));
  await assert.rejects(run('no-delete'), /limpeza|remov/u);
  await writeFile(user, original);
  app.guides.find(g => g.guideId === 'usuario-acesso').steps.splice(2, 0, { stepId: 'novo-passo', text: 'Clique em Novo passo.' });
  await writeFile(join(packageRoot, 'fixture', 'app.json'), JSON.stringify(app));
  await assert.rejects(run('new-step'), /novo-passo/u);
} finally {
  await site.close();
  await rm(root, { recursive: true, force: true });
}
