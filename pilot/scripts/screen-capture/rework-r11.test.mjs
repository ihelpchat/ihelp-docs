import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from '../visual/measure.mjs';
import { loginToQa } from '../guide-proof.mjs';
import { captureFailureLog } from '../../mcp/screen-capture-service.mjs';

const email = 'fixture@example.test';
const password = 'fixture-password-secret';
const token = 'fixture-token-secret';

async function withLoginFixture(mode, run) {
  const server = createServer((request, response) => {
    if (request.url === '/login' && request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<form><input type="email" aria-label="E-mail"><input type="password" aria-label="Senha"><button>Entrar</button></form>
        <script>document.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          const response = await fetch('/api/login?secret=${token}', { method: 'POST' });
          if (${JSON.stringify(mode)} === 'wrong') document.body.insertAdjacentHTML('beforeend', '<div role="alert">Senha incorreta para ${email} ${password}</div>');
          if (${JSON.stringify(mode)} === 'step') document.body.insertAdjacentHTML('beforeend', '<label>Código de confirmação<input></label><button>Continuar</button>');
          if (${JSON.stringify(mode)} === 'session') document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><h5>Usuário já conectado</h5><button>Sim, continuar</button></div>');
        };</script>`);
    } else if (request.url?.startsWith('/api/login')) {
      response.writeHead(mode === 'server' ? 500 : mode === 'wrong' ? 401 : mode === 'session' ? 409 : 200);
      response.end();
    } else {
      response.writeHead(404); response.end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const browser = await launch();
  try { await run(await browser.newPage(), `http://127.0.0.1:${server.address().port}/`); }
  finally { await browser.close(); await new Promise((done) => server.close(done)); }
}

async function failedLogin(page, baseUrl) {
  try {
    await loginToQa(page, baseUrl, { email, password }, { timeoutMs: 400 });
    assert.fail('login não deveria concluir');
  } catch (error) {
    assert.notEqual(error.code, 'ERR_ASSERTION');
    return error;
  }
}

test('senha errada: URL de login sem barra dupla, alerta, HTTP 401 e log sem segredo', async () => {
  await withLoginFixture('wrong', async (page, baseUrl) => {
    const error = await failedLogin(page, baseUrl);
    assert.equal(new URL(page.url()).pathname, '/login');
    assert.equal(error.diagnostic?.outcome, 'alert');
    const log = captureFailureLog(error, { GUIDE_QA_AUTHORIZED_EMAIL: email, GUIDE_QA_AUTHORIZED_PASSWORD: password });
    assert.match(log, /path=\/login.*Senha incorreta.*POST \/api\/login 401/iu);
    assert.doesNotMatch(log, /fixture@|fixture-password|fixture-token|secret=|https?:\/\//iu);
  });
});

test('sessão já ativa para sem acionar force=true', async () => {
  await withLoginFixture('session', async (page, baseUrl) => {
    const error = await failedLogin(page, baseUrl);
    assert.equal(error.diagnostic?.outcome, 'session');
    assert.ok(error.diagnostic.buttons.includes('Sim, continuar'));
    assert.equal(error.diagnostic.requests.length, 1);
    assert.equal(error.diagnostic.requests[0].status, 409);
  });
});

test('segundo passo de login: registra rótulos e para no 2FA', async () => {
  await withLoginFixture('step', async (page, baseUrl) => {
    const error = await failedLogin(page, baseUrl);
    assert.equal(error.diagnostic?.outcome, '2fa');
    const log = captureFailureLog(error);
    assert.match(log, /Código de confirmação.*Continuar/iu);
    assert.doesNotMatch(log, /fixture@|fixture-password|fixture-token|secret=|https?:\/\//iu);
  });
});

test('resposta 500 sem alerta: timeout e método, caminho e status no log', async () => {
  await withLoginFixture('server', async (page, baseUrl) => {
    const error = await failedLogin(page, baseUrl);
    assert.equal(error.diagnostic?.outcome, 'timeout');
    const log = captureFailureLog(error);
    assert.match(log, /POST \/api\/login 500/iu);
    assert.doesNotMatch(log, /fixture@|fixture-password|fixture-token|secret=|https?:\/\//iu);
  });
});

test('login Angular com 2FA para sem código e registra diagnóstico sanitizado', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/login') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<form><input placeholder="E-mail" type="email"><input placeholder="Senha" type="password"><button>ENTRAR</button></form>
        <script>document.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          await fetch('/api/v2/configurations/users/login?force=false', {method:'POST'});
          document.querySelector('form').outerHTML = '<form><h4>Insira o código que você recebeu</h4><input name="input0"><button>VALIDAR</button></form>';
        };</script>`);
    } else if (request.url === '/api/v2/configurations/users/login?force=false') {
      response.writeHead(401); response.end();
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(loginToQa(page, baseUrl, { email, password }, { timeoutMs: 2000 }), (error) => {
      assert.equal(error.code, 'LOGIN_2FA', JSON.stringify(error.diagnostic));
      assert.deepEqual(error.diagnostic.fields, [{ role: 'textbox', label: 'Código' }]);
      assert.deepEqual(error.diagnostic.buttons, ['Validar']);
      assert.equal(error.diagnostic.requests[0].status, 401);
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /fixture@|fixture-password|secret|force=false/iu);
      return true;
    });
  } finally {
    await browser.close(); server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
