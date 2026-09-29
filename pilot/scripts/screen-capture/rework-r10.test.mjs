import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from '../visual/measure.mjs';
import * as guideProof from '../guide-proof.mjs';
import * as screenCapture from '../../mcp/screen-capture-service.mjs';

test('login preenche somente o input de senha com Mostrar senha e Esqueci minha senha presentes', async () => {
  const email = 'fixture@example.test';
  const password = 'fixture-password-only';
  let submitted;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/login' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      submitted = new URLSearchParams(body);
      response.writeHead(302, { Location: '/home' });
      response.end();
    } else if (request.url === '/login') response.end(`<form method="post"><label for="email">E-mail</label><input id="email" name="email" type="email">
      <label for="senha">Senha</label><input id="senha" name="password" type="password">
      <button type="button" aria-label="Mostrar senha">Mostrar senha</button>
      <a href="/forgot">Esqueci minha senha</a><button type="submit">Entrar</button></form>`);
    else response.end('ok');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const browser = await launch();
  try {
    const page = await browser.newPage();
    assert.equal(typeof guideProof.loginToQa, 'function');
    await guideProof.loginToQa(page, `http://127.0.0.1:${server.address().port}`, { email, password });
    assert.equal(submitted?.get('email'), email);
    assert.equal(submitted?.get('password'), password);
    assert.equal(new URL(page.url()).pathname, '/home');
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
});

test('log da captura inclui erro do Playwright sem e-mail, senha, token ou URL com credencial', () => {
  const email = 'fixture@example.test';
  const password = 'fixture-password-only';
  const token = 'fixture-token-only';
  const cause = new Error(`locator.fill: Error: strict mode violation: getByLabel(/senha|password/iu) resolved to 2 elements: ${email} ${password} ${token} https://user:${token}@example.test/login`);
  const error = new Error('Login na homologação falhou', { cause });
  assert.equal(typeof screenCapture.captureFailureLog, 'function');
  const logged = screenCapture.captureFailureLog(error, { GUIDE_QA_AUTHORIZED_EMAIL: email,
    GUIDE_QA_AUTHORIZED_PASSWORD: password, GITHUB_READ_TOKEN: token });
  assert.match(logged, /login na homologação falhou.*strict mode violation/iu);
  assert.doesNotMatch(logged, /fixture@example|fixture-password|fixture-token|https?:\/\/|user:/iu);
});
