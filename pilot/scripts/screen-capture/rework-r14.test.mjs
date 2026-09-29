import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureScreens } from './capture.mjs';
import { captureStepsLog } from '../../mcp/screen-capture-service.mjs';

const step = { page: 'fixture', step: '01-adicionar-contato', label: 'Adicionar Contato',
  role: 'button', route: '/contact', action: 'none', alt: 'Adicionar Contato',
  owner: 'fixture', checkoutSha: 'a'.repeat(40) };

async function fixture(kind, run) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/contact' && kind === 'redirect') {
      response.writeHead(302, { Location: '/empresa' }); response.end(); return;
    }
    if (request.url === '/empresa') { response.end('<title>Escolha a empresa</title>'); return; }
    if (request.url === '/frame') { response.end('<button>Adicionar Contato</button>'); return; }
    if (kind === 'modal') {
      response.end('<title>Contatos</title><button>Adicionar Contato</button><div role="dialog" style="position:fixed;inset:0;background:white"><button aria-label="Fechar aviso" onclick="this.parentElement.remove()">×</button><p>Aviso</p></div>');
    } else if (kind === 'iframe') {
      response.end('<title>Contatos</title><iframe src="/frame" style="width:500px;height:250px"></iframe>');
    } else if (kind === 'duplicate') {
      response.end('<title>Contatos</title><button>Adicionar Contato</button><button>Adicionar Contato</button>');
    } else if (kind === 'shadow') {
      response.end('<title>Contatos</title><div id="host"></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML="<button>Adicionar Contato</button><p>cliente@example.com</p>"</script>');
    } else response.end('<title>Contatos</title><button>Outro rótulo</button>');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r14-'));
  try { await run(`http://127.0.0.1:${server.address().port}`, root); }
  finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
}

for (const [kind, status, reason] of [
  ['redirect', 'pendente', /rota não abriu.*\/empresa/u],
  ['modal', 'capturado', /capturado/u],
  ['iframe', 'capturado', /capturado/u],
  ['duplicate', 'capturado', /capturado/u],
  ['shadow', 'capturado', /capturado/u],
  ['missing', 'pendente', /rótulo não encontrado.*0/u],
]) {
  test(`fixture ${kind}: diagnóstico por passo`, { timeout: 30000 }, async () => {
    await fixture(kind, async (baseUrl, root) => {
      const result = await captureScreens({ baseUrl, root, fixture: true, plan: [step] });
      assert.equal(result.steps.length, 1);
      assert.deepEqual(result.steps[0].step, step.step);
      assert.deepEqual(result.steps[0].label, step.label);
      assert.equal(result.steps[0].status, status);
      assert.match(result.steps[0].motivo, reason);
      assert.equal(result.steps[0].finalPath, kind === 'redirect' ? '/empresa' : '/contact');
      assert.equal(result.steps[0].pageTitle, kind === 'redirect' ? 'Escolha a empresa' : 'Contatos');
      if (kind === 'duplicate') assert.equal(result.steps[0].candidates, 2);
      if (kind === 'shadow') assert.ok(result.entries[0].masked.includes('varredura sensível'));
      assert.equal(result.entries.filter((entry) => entry.page === step.page).length, status === 'capturado' ? 1 : 0);
    });
  });
}

test('log de passos fica em uma linha e omite segredo e texto bruto', () => {
  const log = captureStepsLog([{ step: '01-adicionar-contato', label: 'cliente@example.com',
    status: 'pendente', motivo: 'Cookie: segredo', finalPath: '/contact', pageTitle: 'Contatos\nsegredo', candidates: 0 }]);
  assert.match(log, /steps=/u);
  assert.doesNotMatch(log, /cliente@example|Cookie|segredo|\n/u);
});
