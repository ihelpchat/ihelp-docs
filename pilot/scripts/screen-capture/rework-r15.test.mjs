import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePlan, captureScreens } from './capture.mjs';
import { captureStepsLog } from '../../mcp/screen-capture-service.mjs';

const sha = 'a'.repeat(40);
const step = (label, name = '01-alvo') => ({ page: 'fixture', step: name, label, role: 'button',
  route: '/contact', action: 'none', alt: label, owner: 'fixture', checkoutSha: sha });

async function fixture(html, plan, check) {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<title>Contatos</title>${html}`);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r15-'));
  try {
    const result = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`,
      root, fixture: true, plan });
    check(result);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
}

test('espera até botão aparecer após três segundos', { timeout: 30000 }, async () => {
  await fixture('<script>setTimeout(() => document.body.insertAdjacentHTML("beforeend", "<button>Adicionar Contato</button>"), 3000)</script>',
    [step('Adicionar Contato')], (result) => assert.equal(result.steps[0].status, 'capturado'));
});

test('acha botão de ícone por aria-label normalizado e por tooltip', { timeout: 30000 }, async () => {
  await fixture('<button aria-label=" Adicionar   Contáto ">+</button><button aria-describedby="hint">⋮</button><span id="hint" role="tooltip">MAIS OPÇÕES</span>',
    [step('adicionar contato'), step('mais opcoes', '02-menu')], (result) =>
      assert.deepEqual(result.steps.map((item) => item.status), ['capturado', 'capturado']));
});

test('plano abre gatilho de menu anterior antes de procurar item', { timeout: 30000 }, async () => {
  const plan = capturePlan({ page: 'fixture', module: 'Contatos',
    faqBody: '1. Clique em **Mais opções**.\n2. Escolha **Importar Contatos**.',
    coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }],
    screenFacts: ['Mais opções', 'Importar Contatos'].map((text) => ({ kind: 'action', text,
      route: '/contact', owner: 'fixture', sha })) });
  assert.equal(plan[0].action, 'click');
  await fixture('<button onclick="document.querySelector(\'#menu\').hidden=false">Mais opções</button><div id="menu" role="menu" hidden><button role="menuitem">Importar Contatos</button></div>',
    plan, (result) => assert.deepEqual(result.steps.map((item) => item.status), ['capturado', 'capturado']));
});

test('ausência lista só controles visíveis sanitizados e spinner', { timeout: 30000 }, async () => {
  await fixture('<button>Adicionar Contato</button><a href="#">Ajuda</a><button>cliente@example.com</button><table><tr><td>Nome Secreto</td><td><button>Nome Secreto</button></td></tr></table><div class="skeleton">Carregando</div>',
    [step('Inexistente')], (result) => {
      const motivo = result.steps[0].motivo;
      assert.equal(result.steps[0].status, 'pendente');
      assert.match(motivo, /Adicionar Contato/u);
      assert.match(motivo, /Ajuda/u);
      assert.match(motivo, /spinner\/skeleton: sim/u);
      assert.doesNotMatch(motivo, /Nome Secreto|cliente@example.com/u);
      assert.match(captureStepsLog(result.steps), /Adicionar Contato/u);
    });
});
