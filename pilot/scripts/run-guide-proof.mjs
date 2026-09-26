import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startQaSite } from './visual/serve-qa-build.mjs';
import { credentialsFromEnv, runGuideProof } from './guide-proof.mjs';
import { envCompatibility } from '../mcp/env-compat.mjs';

const names = envCompatibility.guideProof;
const evidenceDir = resolve(import.meta.dirname, '..', '.guide-proof');
const stagingUrl = process.env[names.stagingUrl];
if (stagingUrl) {
  const result = await runGuideProof({ baseUrl: stagingUrl, evidenceDir, credentials: credentialsFromEnv(), appSha: process.env[names.appSha] });
  console.log(JSON.stringify({ mode: result.mode, authorized: result.authorized, denied: result.denied, qr: result.qr }));
} else {
  console.log('pendente: conta de teste de homologação (Bruno)');
  const root = await mkdtemp(join(tmpdir(), 'guide-proof-fixture-'));
  let site;
  try {
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
    site = await startQaSite(root, '');
    const result = await runGuideProof({ baseUrl: site.url, evidenceDir, fixture: true });
    console.log(JSON.stringify({ mode: result.mode, authorized: result.authorized, denied: result.denied, qr: result.qr }));
  } finally {
    await site?.close();
    await rm(root, { recursive: true, force: true });
  }
}
