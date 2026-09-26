import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { proofOutcome, runGuideProof } from '../scripts/guide-proof.mjs';

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
let brokenClick = false;
let brokenSave = false;
let disabledCreate = false;
let straySaveWrites = false;
let channelDetailMissing = false;
let initialRecado = '';
let initialToggle = false;
let toggleClearsMessage = true;
const app = createServer((req, res) => {
  if (req.url === '/login-redirect') { res.writeHead(302, { Location: `${externalUrl}/production` }); res.end(); return; }
  if (req.url === '/external-script') { res.writeHead(302, { Location: `${externalUrl}/production-script` }); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.url === '/login') {
    res.end('<input type="email"><input type="password"><button onclick="/* source: src/features/auth/pages/LoginPage/index.tsx:53 */ location.href=\'/login-redirect\'">Entrar</button>');
  } else if (req.url?.startsWith('/configuracoes/department')) {
    if (!req.url.includes('/demo')) {
      res.end(`<main data-tour-id="guide-department-open"><button onclick="/* source: src/store/slices/tab/tab.slice.ts:16 */ ${brokenClick ? '' : "this.dataset.done='yes'"}">Departamentos</button><table><tr><td onclick="/* source: src/components/ui/components/Tables/components/TableCommonDepartments/index.tsx:235 */ location.href='/configuracoes/department/demo'+location.search">Demo</td></tr></table></main>`);
    } else {
      res.end(`<!doctype html><main><label>Inicio<input name="horarioAtendimentoInicio"></label><div><div><h3>Mensagem automática fora de horário de atendimento</h3></div><button role="switch" aria-checked="false" onclick="/* source: src/components/pages/Configuration/pages/DepartmentById/components/DepartmentConfigExtras/index.tsx:356 */ this.setAttribute('aria-checked',this.getAttribute('aria-checked')==='true'?'false':'true');document.querySelector('#chat').hidden=this.getAttribute('aria-checked')!=='true';if(${toggleClearsMessage})message.textContent=''">Ativar</button></div><div id="chat" hidden><div><div><textarea placeholder="Crie uma mensagem..."></textarea></div></div><button aria-label="Enviar" onclick="/* source: src/components/shared/Chat/components/ChatView/index.tsx:210 */ const value=document.querySelector('textarea').value;if(value)message.textContent=value"><svg class="w-6"></svg>Enviar</button></div><p class="whitespace-pre-line" id="message"></p><button ${req.url?.includes('role=denied') ? 'disabled' : ''}>Salvar Alterações</button></main><script>
        const denied=new URLSearchParams(location.search).has('role');const message=document.querySelector('#message');
        document.querySelector('[name=horarioAtendimentoInicio]').value=localStorage.getItem('proof-hour')||'';
        message.textContent=localStorage.getItem('proof-recado')??${JSON.stringify(initialRecado)};
        document.querySelector('[role=switch]').setAttribute('aria-checked',localStorage.getItem('proof-toggle')??${JSON.stringify(String(initialToggle))});
        document.querySelector('#chat').hidden=document.querySelector('[role=switch]').getAttribute('aria-checked')!=='true';
        document.querySelector('main > button:last-of-type').onclick=()=>{if(!denied&&!${brokenSave}){localStorage.setItem('proof-recado',message.textContent);localStorage.setItem('proof-hour',document.querySelector('[name=horarioAtendimentoInicio]').value);localStorage.setItem('proof-toggle',document.querySelector('[role=switch]').getAttribute('aria-checked'))}}; // source: src/components/pages/Configuration/pages/DepartmentById/components/DepartmentConfigExtras/index.tsx:469
      </script>`);
    }
  } else if (req.url?.startsWith('/configuracoes/channel')) {
    if (req.url.includes('/demo') && !channelDetailMissing) res.end(`<main><button onclick="/* source: src/components/pages/Configuration/pages/ChannelById/components/ChannelDetails/index.tsx:122 */ this.dataset.done='yes'">Conectar</button></main>`);
    else res.end(`<main data-tour-id="guide-qr-open"><button onclick="/* source: src/store/slices/tab/tab.slice.ts:14 */ ${brokenClick ? '' : "this.dataset.done='yes'"}">Canais</button><table><tr><td onclick="/* source: src/components/ui/components/Tables/components/TableCommonChannels/index.tsx:175 */ location.href='/configuracoes/channel/demo'+location.search">Canal de teste</td></tr></table></main>`);
  } else if (req.url?.startsWith('/configuracoes/usuarios')) {
    res.end(`<!doctype html><main><section aria-label="Configurações extras"><button>Salvar Alterações</button></section><section aria-label="Dados do usuário"><label>Nome<input name="nome"></label><label>E-mail<input name="email"></label><input name="senha" type="password"><input name="senhaConfirmacao" type="password"><label>Departamentos<select aria-label="Departamentos"><option value="">Escolha</option><option value="demo">Demo</option></select></label><label>Perfil<select aria-label="Perfil"><option value="">Escolha</option><option value="atendente">Atendente</option></select></label><button>Salvar Alterações</button></section><ul id="items"></ul><output data-proof-state></output></main><script>
      const key='proof-users'; const denied=new URLSearchParams(location.search).has('role');
      document.querySelector('[data-proof-state]').textContent=localStorage.getItem('proof-stray')||'';
      document.querySelector('[aria-label="Configurações extras"] button').onclick=()=>{if(denied&&${straySaveWrites})localStorage.setItem('proof-stray','written')}; // source: src/components/pages/Configuration/pages/UserById/components/UserData/index.tsx:292
      function render(){document.querySelector('#items').innerHTML=JSON.parse(localStorage.getItem(key)||'[]').map(name=>'<li data-proof-item="'+name+'">'+name+'<button>Excluir</button></li>').join('')};render();
      document.body.onclick=e=>{let b=e.target.closest('button');if(!b)return; // source: src/components/pages/Configuration/pages/UserById/components/UserData/index.tsx:292
        if(b.textContent==='Excluir'){if(!${deletionDisabled}&&!denied)localStorage.setItem(key,JSON.stringify(JSON.parse(localStorage.getItem(key)||'[]').filter(x=>x!==b.parentElement.dataset.proofItem)));render();return}
        if(b.textContent==='Salvar Alterações'&&b.closest('section').getAttribute('aria-label')==='Dados do usuário'&&(!denied||${deniedWrite})){let s=b.closest('section');if(s.querySelector('[name=nome]').value&&s.querySelector('[name=email]').value&&s.querySelector('[name=senha]').value&&s.querySelector('[name=senhaConfirmacao]').value&&s.querySelector('[aria-label=Departamentos]').value){localStorage.setItem(key,JSON.stringify([...JSON.parse(localStorage.getItem(key)||'[]'),s.querySelector('[name=nome]').value]));render()}}
      };
    </script>`);
  } else {
    res.end(`<!doctype html>${externalScript ? '<script src="/external-script"></script>' : ''}<main data-tour-id="${markerRemoved ? 'removed' : 'guide-user-open'}"><button onclick="/* source: src/store/slices/tab/tab.slice.ts:21 */ ${brokenClick ? '' : "this.dataset.done='yes'"}">Usuários</button><button ${disabledCreate && req.url?.includes('denied') ? 'disabled' : ''} onclick="/* source: src/components/pages/Configuration/components/TabUser/index.tsx:120 */ location.href='/configuracoes/usuarios'+location.search">Novo usuário</button><section><button onclick="/* source: src/components/pages/Configuration/pages/UserById/components/UserData/index.tsx:292 */ if(new URLSearchParams(location.search).has('role')&&${straySaveWrites})localStorage.setItem('proof-stray','written')">Salvar Alterações</button></section><output data-proof-state></output></main><script>document.querySelector('[data-proof-state]').textContent=localStorage.getItem('proof-stray')||''</script>`);
  }
});
app.listen(0, '127.0.0.1');
await once(app, 'listening');
const baseUrl = `http://127.0.0.1:${app.address().port}`;
const run = name => runGuideProof({ baseUrl, fixture: true, packageRoot, evidenceDir: join(root, name) });
const fixtureSource = await readFile(fileURLToPath(import.meta.url), 'utf8');
const fixtureHandlers = fixtureSource.slice(0, fixtureSource.indexOf('const fixtureSource'));
for (const [, handler] of fixtureHandlers.matchAll(/onclick="([^"]*)"/gu)) {
  assert.match(handler, /^\/\* source: src\/[\w/.-]+:\d+ \*\//u, 'handler inline sem citação do front');
}
for (const line of fixtureHandlers.split('\n').filter(line => /\.onclick\s*=|\.onkeydown\s*=/u.test(line))) {
  assert.match(line, /source: src\/[\w/.-]+:\d+/u, `handler sem citação do front: ${line.trim().slice(0, 80)}`);
}
const qrScriptPath = fileURLToPath(new URL('../scripts/guide-proof/roteiros/reconectar-canal-qr.json', import.meta.url));
const recadoScriptPath = fileURLToPath(new URL('../scripts/guide-proof/roteiros/recado-fora-do-horario.json', import.meta.url));
const runnerPath = fileURLToPath(new URL('../scripts/guide-proof.mjs', import.meta.url));
const mutatedRunnerPath = fileURLToPath(new URL(`../scripts/.guide-proof-toggle-mutation-${process.pid}.mjs`, import.meta.url));
async function mutateScript(path, edit, label, pattern) {
  const original = await readFile(path, 'utf8');
  try {
    const mutated = edit(JSON.parse(original));
    await writeFile(path, JSON.stringify(mutated));
    await assert.rejects(run(label), pattern);
  } finally { await writeFile(path, original); }
}
try {
  const report = await run('journey');
  const recado = { guide: recadoGuide };
  const recadoSteps = report.steps.filter(step => step.guideId === recadoGuide.guideId);
  // A fixture emite o mesmo formato do runner; só o ambiente, SHA e escopo mudam.
  const { outcome: _fixtureOutcome, ...emitted } = report;
  const verified = { ...emitted, mode: 'staging', appSha: 'a'.repeat(40), steps: recadoSteps };
  const evaluate = (changed) => proofOutcome(changed, { guides: [recado], appSha: verified.appSha });
  assert.deepEqual(evaluate(verified), { ok: true, pending: [] }, 'blocked no perfil negado é prova correta');
  const failed = (changed, reason) => {
    const outcome = evaluate(changed);
    assert.equal(outcome.ok, false);
    assert.ok(outcome.pending.some(item => item.includes(reason)), JSON.stringify(outcome.pending));
  };
  failed({ ...verified, steps: [] }, 'recado-fora-do-horario');
  const authorized = recadoSteps.find(step => step.role === 'authorized' && step.status === 'passed');
  const denied = recadoSteps.find(step => step.role === 'denied' && step.status === 'blocked');
  assert.ok(authorized && denied, 'fixture deve emitir ambos os perfis');
  failed({ ...verified, cleanupPending: [{ guideId: recadoGuide.guideId, reason: 'restauração não persistiu' }] }, 'cleanupPending');
  failed({ ...verified, warning: 'limpeza pendente' }, 'warning');
  failed({ ...verified, foo: 'novo problema do runner' }, 'foo');
  failed({ ...verified, steps: [...recadoSteps, { ...authorized, status: 'manual_required' }] }, 'manual_required');
  failed({ ...verified, steps: recadoSteps.map(step => step === authorized ? { ...step, status: 'manual_required' } : step) }, `${authorized.guideId}/${authorized.stepId}`);
  failed({ ...verified, steps: recadoSteps.filter(step => step !== authorized) }, `${authorized.guideId}/${authorized.stepId}`);
  failed({ ...verified, steps: recadoSteps.map(step => step === denied ? { ...step, status: 'passed' } : step) }, `${denied.guideId}/${denied.stepId}`);
  failed({ ...verified, appSha: 'b'.repeat(40) }, 'SHA');
  failed({ ...verified, mode: 'fixture' }, 'staging');
  assert.equal(report.authorized, 'passed');
  assert.equal(report.denied, 'passed');
  assert.ok(report.cleanup.some(x => x.guideId === 'usuario-acesso' && x.status === 'removed'));
  assert.ok(report.steps.some(x => x.stepId === 'salvar-usuario' && x.status === 'passed'));
  assert.ok(report.steps.some(x => x.stepId === 'ler-codigo' && x.status === 'manual_required'));
  assert.ok(report.cleanup.some(x => x.guideId === 'recado-fora-do-horario' && x.status === 'restored'));
  initialRecado = 'Recado anterior de teste';
  initialToggle = true;
  const preexisting = await run('preexisting-recado');
  assert.ok(preexisting.cleanup.some(x => x.guideId === 'recado-fora-do-horario' && x.status === 'restored'));
  initialRecado = '';
  initialToggle = false;
  toggleClearsMessage = false;
  const pending = await run('cannot-clear-recado');
  assert.equal(pending.warning, 'limpeza pendente');
  assert.ok(pending.cleanupPending.some(x => x.guideId === 'recado-fora-do-horario'));
  assert.ok(!pending.cleanup.some(x => x.guideId === 'recado-fora-do-horario' && x.status === 'restored'));
  toggleClearsMessage = true;
  await mutateScript(qrScriptPath, script => { delete script.conectar.enter; return script; }, 'connect-without-detail', /Conectar|Timeout/u);
  await mutateScript(recadoScriptPath, script => { script['escrever-recado'].commit = { selector: 'textarea[placeholder="Crie uma mensagem..."]', press: 'Enter' }; return script; }, 'enter-instead-of-button', /gravação não persistiu|restaura/u);
  const runnerSource = await readFile(runnerPath, 'utf8');
  const restoreToggle = "if (toggle && source.verifySelector && before === '') {\n                    await toggle.click();\n                    if (changed.get('toggle')) await toggle.click();\n                  } else if (toggle && await toggle.isChecked() !== changed.get('toggle')) await toggle.click();";
  assert.ok(runnerSource.includes(restoreToggle), 'ponto da mutação do Toggle não encontrado');
  try {
    await writeFile(mutatedRunnerPath, runnerSource.replace(restoreToggle, 'if (false) await toggle.click();'));
    const { runGuideProof: runMutated } = await import(new URL(`../scripts/.guide-proof-toggle-mutation-${process.pid}.mjs`, import.meta.url));
    const mutated = await runMutated({ baseUrl, fixture: true, packageRoot, evidenceDir: join(root, 'toggle-without-restore') });
    assert.equal(mutated.warning, 'limpeza pendente');
    assert.ok(!mutated.cleanup.some(x => x.guideId === 'recado-fora-do-horario' && x.status === 'restored'));
  } finally { await rm(mutatedRunnerPath, { force: true }); }
  const emptySendMutation = runnerSource.replace(restoreToggle, 'if (false) await toggle.click();')
    .replace("(prior.control.verifySelector ? before : changed.get(prior.control.fields[0].selector)) !== '' && ", '');
  assert.notEqual(emptySendMutation, runnerSource, 'mutação de envio vazio não aplicada');
  try {
    await writeFile(mutatedRunnerPath, emptySendMutation);
    const { runGuideProof: runMutatedEmpty } = await import(new URL(`../scripts/.guide-proof-toggle-mutation-${process.pid}.mjs?empty`, import.meta.url));
    const mutated = await runMutatedEmpty({ baseUrl, fixture: true, packageRoot, evidenceDir: join(root, 'restore-by-empty-send') });
    assert.equal(mutated.warning, 'limpeza pendente');
    assert.ok(!mutated.cleanup.some(x => x.guideId === 'recado-fora-do-horario' && x.status === 'restored'));
  } finally { await rm(mutatedRunnerPath, { force: true }); }
  channelDetailMissing = true;
  await assert.rejects(run('missing-channel-detail'), /Conectar|controle|visible|Timeout/u);
  channelDetailMissing = false;
  brokenClick = true;
  await assert.rejects(run('broken-click'), /ação web não concluiu/u);
  brokenClick = false;
  brokenSave = true;
  await assert.rejects(run('broken-save'), /gravação não persistiu/u);
  brokenSave = false;
  disabledCreate = true;
  straySaveWrites = true;
  await assert.rejects(run('disabled-create-stray-save'), /negado|alterou/u);
  disabledCreate = false;
  straySaveWrites = false;
  await assert.rejects(runGuideProof({ baseUrl: 'https://app.ihelpchat.com', evidenceDir: join(root, 'production') }), /recusad|permitid/u);
  markerRemoved = true;
  await assert.rejects(run('missing-marker'), /guide-user-open/u);
  markerRemoved = false;
  deniedWrite = true;
  await assert.rejects(run('denied-write'), /negado|alterou/u);
  deniedWrite = false;
  straySaveWrites = true;
  await assert.rejects(run('stray-save-reachable'), /negado|alterou/u);
  straySaveWrites = false;
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
