import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { launch } from '../visual/measure.mjs';
import * as proof from '../guide-proof.mjs';
import { captureFailureLog } from '../../mcp/screen-capture-service.mjs';

const front = 'qa-front-production.up.railway.app';
const api = 'qa-api-production.up.railway.app';
const env = { GUIDE_QA_ALLOWED_HOSTS: `${front},${api}` };

test('a política comum aceita as duas origens de QA e recusa hosts externos e produção', () => {
  assert.equal(typeof proof.qaRequestDecision, 'function');
  const target = proof.assertAllowedTarget(`https://${front}`, env);
  assert.equal(proof.qaRequestDecision(`https://${api}/api/login`, target, env).allowed, true);
  assert.equal(proof.qaRequestDecision('https://outside.example.test/api/login', target, env).allowed, false);
  for (const host of ['apiv3.ihelpchat.com', 'app.ihelpchat.com', 'app3.ihelpchat.com',
    'api.ihelpchat.com', 'api.ihelp.com.br', 'staging.ihelpchat.com']) {
    const configured = { GUIDE_QA_ALLOWED_HOSTS: `${front},${host}` };
    assert.deepEqual(proof.qaRequestDecision(`https://${host}/api/login`, target, configured),
      { allowed: false, host, reason: 'bloqueado: host de produção' });
  }
  assert.equal(proof.qaRequestDecision(`http://${api}/api/login`, target, env).allowed, false);
});

async function fixture(run) {
  let apiHits = 0;
  const apiServer = createServer((request, response) => {
    apiHits++;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end('ok');
  });
  await new Promise((done) => apiServer.listen(0, '127.0.0.1', done));
  const apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
  const frontServer = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: `${apiUrl}/api/login` }); response.end(); return; }
    if (request.url === '/production-redirect') {
      response.writeHead(302, { Location: 'https://apiv3.ihelpchat.com/api/login' }); response.end(); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<button>Entrar</button><script>document.querySelector('button').onclick = async () => {
      try { await fetch('${apiUrl}/api/login', { mode: 'no-cors' }); document.body.dataset.login = 'ok'; }
      catch { document.body.dataset.login = 'failed'; }
    };</script>`);
  });
  await new Promise((done) => frontServer.listen(0, '127.0.0.1', done));
  const browser = await launch();
  try { await run(browser, `http://127.0.0.1:${frontServer.address().port}`, apiUrl, () => apiHits); }
  finally {
    await browser.close();
    await Promise.all([frontServer, apiServer].map((server) => new Promise((done) => server.close(done))));
  }
}

test('fixture com front e API em origens distintas: login, bloqueio e redirect', async () => {
  assert.equal(typeof proof.installQaNetworkGuard, 'function');
  await fixture(async (browser, frontUrl, apiUrl, hits) => {
    const context = await browser.newContext();
    const target = proof.assertAllowedTarget(frontUrl);
    const guard = await proof.installQaNetworkGuard(context, target, {}, { fixtureAllowedOrigins: [apiUrl] });
    const page = await context.newPage();
    const failed = [];
    page.on('requestfailed', (request) => failed.push(proof.qaFailedRequest(request, guard)));
    await page.goto(frontUrl);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForFunction(() => document.body.dataset.login === 'ok');
    assert.equal(hits(), 1);
    assert.equal(guard.blocked.length, 0);
    await page.goto(`${frontUrl}/redirect`);
    assert.equal(new URL(page.url()).origin, apiUrl);
    await assert.rejects(page.goto(`${frontUrl}/production-redirect`), /ERR_FAILED/u);
    assert.deepEqual(guard.blocked.at(-1), { allowed: false, host: 'apiv3.ihelpchat.com',
      reason: 'bloqueado: host de produção' });
    assert.match(failed.at(-1), /GET apiv3\.ihelpchat\.com bloqueado: host de produção net::ERR_FAILED/u);
    await context.close();
  });
});

test('requisição abortada aparece no diagnóstico apenas com método, host e motivo', async () => {
  assert.equal(typeof proof.installQaNetworkGuard, 'function');
  await fixture(async (browser, frontUrl, apiUrl, hits) => {
    const context = await browser.newContext();
    const target = proof.assertAllowedTarget(frontUrl);
    const guard = await proof.installQaNetworkGuard(context, target);
    const page = await context.newPage();
    const failed = [];
    page.on('requestfailed', (request) => failed.push(proof.qaFailedRequest(request, guard)));
    await page.goto(frontUrl);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForFunction(() => document.body.dataset.login === 'failed');
    assert.equal(hits(), 0);
    assert.deepEqual(guard.blocked.map((item) => item.host), [new URL(apiUrl).host]);
    assert.match(failed[0], /GET 127\.0\.0\.1:\d+ .*net::ERR_FAILED/u);
    const log = captureFailureLog({ diagnostic: { outcome: 'alert', path: '/login',
      messages: ['Network Error'], requests: [], failed, controls: [] } });
    assert.match(log, /failed=GET 127\.0\.0\.1:\d+ .*net::ERR_FAILED/u);
    assert.doesNotMatch(log, /https?:\/\/|\/api\/login/u);
    await context.close();
  });
});
