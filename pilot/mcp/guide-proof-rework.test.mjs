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
await mkdir(join(packageRoot, 'fixture'), { recursive: true });
await writeFile(join(packageRoot, 'manifest.json'), JSON.stringify({ current: 'fixture' }));
const savePackage = async () => writeFile(join(packageRoot, 'fixture', 'app.json'), JSON.stringify({ guides: [guide] }));
await savePackage();
let externalHits = 0;
const external = createServer((req, res) => { externalHits++; res.writeHead(200); res.end('external'); });
external.listen(0, '127.0.0.1');
await once(external, 'listening');
const externalUrl = `http://127.0.0.1:${external.address().port}`;
const app = createServer((req, res) => {
  if (req.url === '/login-redirect') { res.writeHead(302, { Location: `${externalUrl}/production` }); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (req.url?.startsWith('/configuracoes/usuarios')) {
    res.end(`<!doctype html><main><section aria-label="Dados do usuário"><label>Nome<input name="nome"></label><label>E-mail<input name="email"></label><label>Departamentos<select aria-label="Departamentos"><option value="">Escolha</option><option value="demo">Demo</option></select></label><label>Acesso<select aria-label="Acesso"><option value="">Escolha</option><option value="atendente">Atendente</option></select></label><button>Salvar Alterações</button></section><section aria-label="Configurações extras"><button>Salvar Alterações</button></section><ul id="items"></ul></main><script>
      const key='proof-users'; const denied=new URLSearchParams(location.search).has('role');
      function render(){document.querySelector('#items').innerHTML=JSON.parse(localStorage.getItem(key)||'[]').map(name=>'<li data-proof-item="'+name+'">'+name+'<button>Excluir</button></li>').join('')};render();
      document.body.onclick=e=>{let b=e.target.closest('button');if(!b)return;
        if(b.textContent==='Excluir'){if(!denied)localStorage.setItem(key,JSON.stringify(JSON.parse(localStorage.getItem(key)||'[]').filter(x=>x!==b.parentElement.dataset.proofItem)));render();return}
        if(b.textContent==='Salvar Alterações'&&b.closest('section').getAttribute('aria-label')==='Dados do usuário'&&!denied){let s=b.closest('section');if(s.querySelector('[name=nome]').value&&s.querySelector('[name=email]').value&&s.querySelector('[aria-label=Departamentos]').value){localStorage.setItem(key,JSON.stringify([...JSON.parse(localStorage.getItem(key)||'[]'),s.querySelector('[name=nome]').value]));render()}}
      };
    </script>`);
  } else {
    res.end(`<!doctype html><main data-tour-id="guide-user-open"><button onclick="this.dataset.done='yes'">Usuários</button><button onclick="location.href='/configuracoes/usuarios'+location.search">Novo usuário</button></main>`);
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
  guide.steps.splice(3, 0, { stepId: 'sem-roteiro' });
  await savePackage();
  const incomplete = await run('unmapped');
  assert.ok(incomplete.steps.some(x => x.stepId === 'sem-roteiro' && x.status === 'manual_required'));
  guide.steps.splice(3, 1);
  await savePackage();
  await assert.rejects(runGuideProof({ baseUrl: `${baseUrl}/login-redirect`, fixture: true, packageRoot, evidenceDir: join(root, 'redirect') }));
  assert.equal(externalHits, 0, 'redirect não pode chegar ao host externo');
} finally {
  await new Promise(resolve => app.close(resolve));
  await new Promise(resolve => external.close(resolve));
  await rm(root, { recursive: true, force: true });
}
