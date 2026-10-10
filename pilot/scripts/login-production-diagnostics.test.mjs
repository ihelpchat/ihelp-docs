import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from './visual/measure.mjs';
import { loginToQa } from './guide-proof.mjs';

const credentials = { email: 'fixture@example.test', password: 'fixture-password-secret' };

async function withPage(html, callback) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.url === '/frame' ? `<form><input aria-label="E-mail" type="email"><input aria-label="Senha" type="password"><button>Entrar</button></form><script>document.querySelector('form').onsubmit = e => { e.preventDefault(); document.body.innerHTML = '<h4>Código de confirmação</h4><input aria-label="Código"><button>Validar</button>'; }</script>` : html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await launch();
  try { await callback(await browser.newPage(), `http://127.0.0.1:${server.address().port}`); }
  finally { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test('login tardio em iframe: captura print, encontra formulário e para no 2FA', async () => {
  await withPage('<script>setTimeout(() => document.body.innerHTML = `<iframe src="/frame"></iframe>`, 150)</script>',
    async (page, baseUrl) => {
      let screenshots = 0;
      await assert.rejects(loginToQa(page, baseUrl, credentials, { productionDiagnostics: true, timeoutMs: 1000,
        captureLoginScreenshot: (bytes) => { assert.ok(bytes.length > 100); screenshots++; return 'fixture-id'; } }),
      (error) => {
        assert.equal(error.code, 'LOGIN_2FA', JSON.stringify(error.diagnostic));
        assert.equal(error.diagnostic.surfaces.frameCount, 2);
        assert.equal(error.diagnostic.screenshotId, 'fixture-id');
        assert.doesNotMatch(JSON.stringify(error.diagnostic), /fixture@|fixture-password/iu);
        return true;
      });
      assert.equal(screenshots, 1);
    });
});

test('login em shadow root aberto: usa os controles sem acionar sessão ativa', async () => {
  await withPage(`<div id="host"></div><script>
    const root = document.querySelector('#host').attachShadow({mode:'open'});
    root.innerHTML = '<form><input aria-label="E-mail" type="email"><input aria-label="Senha" type="password"><button>Entrar</button></form>';
    root.querySelector('form').onsubmit = e => { e.preventDefault(); root.innerHTML = '<h4>Código de confirmação</h4><input aria-label="Código"><button>Validar</button>'; };
    </script>`, async (page, baseUrl) => {
    await assert.rejects(loginToQa(page, baseUrl, credentials, { productionDiagnostics: true, timeoutMs: 1000,
      captureLoginScreenshot: () => 'fixture-id' }), (error) => {
      assert.equal(error.code, 'LOGIN_2FA', JSON.stringify(error.diagnostic));
      assert.equal(error.diagnostic.surfaces.shadowRootCount, 1);
      return true;
    });
  });
});

test('sem formulário: retorna contagens, console sanitizado e id do print', async () => {
  await withPage('<h1>Aguarde</h1><script>console.error("falha https://example.test/a?token=secret-value")</script>',
    async (page, baseUrl) => {
      await assert.rejects(loginToQa(page, baseUrl, credentials, { productionDiagnostics: true,
        inputTimeoutMs: 300, captureLoginScreenshot: () => 'fixture-id' }), (error) => {
        assert.equal(error.diagnostic.surfaces.frames[0].inputs, 0);
        assert.deepEqual(error.diagnostic.surfaces.frames[0].titles, ['Aguarde']);
        assert.equal(error.diagnostic.screenshotId, 'fixture-id');
        assert.doesNotMatch(JSON.stringify(error.diagnostic), /secret-value|token=/u);
        return true;
      });
    });
});

test('login concluído preserva diagnóstico inicial e id do print', async () => {
  await withPage('<form><input type="email"><input type="password"><button>Entrar</button></form><script>document.querySelector("form").onsubmit = e => { e.preventDefault(); location.href = "/contact"; }</script>',
    async (page, baseUrl) => {
      const result = await loginToQa(page, baseUrl, credentials, { productionDiagnostics: true,
        timeoutMs: 1000, captureLoginScreenshot: () => 'fixture-id' });
      assert.equal(result.screenshotId, 'fixture-id');
      assert.equal(result.surfaces.frames[0].inputs, 2);
      assert.deepEqual(result.consoleErrors, []);
    });
});
