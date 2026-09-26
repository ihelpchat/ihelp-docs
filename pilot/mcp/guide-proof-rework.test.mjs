import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuideProof } from '../scripts/guide-proof.mjs';

const root = await mkdtemp(join(tmpdir(), 'guide-proof-rework-'));
const packageRoot = join(root, 'package');
const guide = {
  guideId: 'usuario-acesso', version: 1,
  steps: ['abrir-usuarios', 'criar-usuario', 'preencher-dados', 'escolher-departamento', 'revisar-acesso', 'salvar-usuario', 'pedir-ajuda']
    .map(stepId => ({ stepId, ...(stepId === 'abrir-usuarios' ? { actionId: 'abrir-usuarios' } : {}) })),
};
const qrGuide = { guideId: 'reconectar-canal-qr', version: 1, steps: [
  { stepId: 'abrir-canais', actionId: 'abrir-canais' }, { stepId: 'conectar' }, { stepId: 'ler-codigo' },
] };
const recadoGuide = { guideId: 'recado-fora-do-horario', version: 1, steps: [
  { stepId: 'abrir-departamentos', actionId: 'abrir-departamentos' }, { stepId: 'configurar-horario' },
  { stepId: 'escrever-recado' }, { stepId: 'salvar-recado' },
] };
await mkdir(join(packageRoot, 'fixture'), { recursive: true });
await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({ current: 'fixture' }));
const savePackage = async () => writeFile(join(packageRoot, 'fixture', 'app.json'), JSON.stringify({ guides: [guide, qrGuide, recadoGuide] }));
await savePackage();
let externalHits = 0;
const external = createServer((req, res) => { externalHits++; res.writeHead(200); res.end('external'); });
external.listen(0, '127.0.0.1');
await once(external, 'listening');
const externalUrl = `http://127.0.0.1:${external.address().port}`;
let markerRemoved = false;
let deniedWrite = false;
let deletionDisabled = false;
let externalScript = false;
const app = createServer((req, res) => {
  if (req.url === '/login-redirect') { res.writeHead(302, { Location: `${externalUrl}/production` }); res.end(); return; }
  if (req.url === '/external-script') { res.writeHead(302, { Location: `${externalUrl}/production-script` }); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.url === '/login') {
    res.end('<input type="email"><input type="password"><button onclick="location.href=\'/login-redirect\'">Entrar</button>');
  } else if (req.url?.startsWith('/configuracoes/department')) {
    res.end(`<!doctype html><main data-tour-id="guide-department-open"><button onclick="this.dataset.done='yes'">Departamentos</button><label>Horário<input aria-label="Horário"></label><label>Mensagem automática fora de horário de atendimento<input aria-label="Mensagem automática fora de horário de atendimento"></label><button>Salvar Alterações</button></main><script>
      const denied=new URLSearchParams(location.search).has('role'); const field=document.querySelector('[aria-label="Mensagem automática fora de horário de atendimento"]');
      field.value=localStorage.getItem('proof-recado')||'';
      document.querySelector('button:last-of-type').onclick=()=>{if(!denied)localStorage.setItem('proof-recado',field.value)};
    </script>`);
  } else if (req.url?.startsWith('/configuracoes/channel')) {
    res.end('<main data-tour-id="guide-qr-open"><button onclick="this.dataset.done=\'yes\'">Canais</button><button onclick="this.dataset.done=\'yes\'">Conectar</button></main>');
  } else if (req.url?.startsWith('/configuracoes/usuarios')) {
    res.end(`<!doctype html><main><section aria-label="Configurações extras"><button>Salvar Alterações</button></section><section aria-label="Dados do usuário"><label>Nome<input name="nome"></label><label>E-mail<input name="email"></label><input name="senha" type="password"><input name="senhaConfirmacao" type="password"><label>Departamentos<select aria-label="Departamentos"><option value="">Escolha</option><option value="demo">Demo</option></select></label><label>Perfil<select aria-label="Perfil"><option value="">Escolha</option><option value="atendente">Atendente</option></select></label><button>Salvar Alterações</button></section><ul id="items"></ul></main><script>
      const key='proof-users'; const denied=new URLSearchParams(location.search).has('role');
      function render(){document.querySelector('#items').innerHTML=JSON.parse(localStorage.getItem(key)||'[]').map(name=>'<li data-proof-item="'+name+'">'+name+'<button>Excluir</button></li>').join('')};render();
      document.body.onclick=e=>{let b=e.target.closest('button');if(!b)return;
        if(b.textContent==='Excluir'){if(!${deletionDisabled}&&!denied)localStorage.setItem(key,JSON.stringify(JSON.parse(localStorage.getItem(key)||'[]').filter(x=>x!==b.parentElement.dataset.proofItem)));render();return}
        if(b.textContent==='Salvar Alterações'&&b.closest('section').getAttribute('aria-label')==='Dados do usuário'&&(!denied||${deniedWrite})){let s=b.closest('section');if(s.querySelector('[name=nome]').value&&s.querySelector('[name=email]').value&&s.querySelector('[name=senha]').value&&s.querySelector('[name=senhaConfirmacao]').value&&s.querySelector('[aria-label=Departamentos]').value){localStorage.setItem(key,JSON.stringify([...JSON.parse(localStorage.getItem(key)||'[]'),s.querySelector('[name=nome]').value]));render()}}
      };
    </script>`);
  } else {
    res.end(`<!doctype html>${externalScript ? '<script src="/external-script"></script>' : ''}<main data-tour-id="${markerRemoved ? 'removed' : 'guide-user-open'}"><button onclick="this.dataset.done='yes'">Usuários</button><button onclick="location.href='/configuracoes/usuarios'+location.search">Novo usuário</button></main>`);
  }
});
app.listen(0, '127.0.0.1');
await once(app, 'listening');
const baseUrl = `http://127.0.0.1:${app.address().port}`;
const run = name => runGuideProof({ baseUrl, fixture: true, packageRoot, evidenceDir: join(root, name) });
try {
  const report = await run('journey');
  assert.equal(report.authorized, 'passed');
  assert.equal(report.denied, 'passed');
  assert.ok(report.cleanup.some(x => x.guideId === 'usuario-acesso' && x.status === 'removed'));
  assert.ok(report.steps.some(x => x.stepId === 'salvar-usuario' && x.status === 'passed'));
  assert.ok(report.steps.some(x => x.stepId === 'ler-codigo' && x.status === 'manual_required'));
  await assert.rejects(runGuideProof({ baseUrl: 'https://app.ihelpchat.com', evidenceDir: join(root, 'production') }), /recusad|permitid/u);
  markerRemoved = true;
  await assert.rejects(run('missing-marker'), /guide-user-open/u);
  markerRemoved = false;
  deniedWrite = true;
  await assert.rejects(run('denied-write'), /negado|alterou/u);
  deniedWrite = false;
  deletionDisabled = true;
  await assert.rejects(run('no-delete'), /limpeza|remov/u);
  deletionDisabled = false;
  externalScript = true;
  await assert.rejects(run('external-script'), /host autorizado/u);
  assert.equal(externalHits, 0, 'script externo não pode chegar ao host externo');
  externalScript = false;
  guide.steps.splice(3, 0, { stepId: 'sem-roteiro' });
  await savePackage();
  const incomplete = await run('unmapped');
  assert.ok(incomplete.steps.some(x => x.stepId === 'sem-roteiro' && x.status === 'manual_required'));
  guide.steps.splice(3, 1);
  await savePackage();
  await assert.rejects(runGuideProof({ baseUrl, fixture: true, fixtureLogin: true, credentials: { authorized: { email: 'test@example.invalid', password: 'fake' } }, packageRoot, evidenceDir: join(root, 'redirect') }));
  assert.equal(externalHits, 0, 'redirect não pode chegar ao host externo');
} finally {
  await new Promise(resolve => app.close(resolve));
  await new Promise(resolve => external.close(resolve));
  await rm(root, { recursive: true, force: true });
}
