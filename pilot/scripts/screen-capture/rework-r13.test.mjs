import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureScreens } from './capture.mjs';
import { captureFailureLog } from '../../mcp/screen-capture-service.mjs';

const secret = 'CfDJ8TESTE123456';
const playwrightError = new Error(`TimeoutError: waiting for target\nCall log:\n  cookie: .AspNetCore.Identity.Application=${secret}\n  authorization: Bearer eyJhbGciOiJIUzI1NiJ9.fixture.signature`);
const plan = ['Primeiro', 'Segundo', 'Terceiro'].map((label, index) => ({
  page: 'fixture', step: `0${index + 1}-${label.toLowerCase()}`, role: 'button', label,
  route: '/app', action: 'none', alt: label, owner: 'fixture', checkoutSha: 'a'.repeat(40),
}));

async function withFixture(run) {
  const server = createServer((request, response) => {
    if (request.url === '/login') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<input type="email"><input type="password"><button>Entrar</button><script>document.querySelector("button").onclick=()=>location.href="/app"</script>');
    } else if (request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write('data: ready\n\n');
    } else if (request.url === '/app') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<button>Primeiro</button><button>Segundo</button><button>Terceiro</button><script>new EventSource("/events"); fetch("/missing").catch(()=>{});</script>');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r13-'));
  try { await run(`http://127.0.0.1:${server.address().port}`, root); }
  finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
}

test('login, stream infinito e três passos concluem em menos de 60 s', { timeout: 60000 }, async () => {
  await withFixture(async (baseUrl, root) => {
    const started = Date.now();
    const manifest = await captureScreens({ baseUrl, root, fixture: true, plan,
      fixtureCredentials: { email: 'fixture@example.test', password: 'fixture-password' } });
    assert.equal(manifest.entries.length, 3);
    assert.ok(Date.now() - started < 60000);
  });
});

test('TimeoutError em handler e passo vira pendência e captura continua', { timeout: 60000 }, async () => {
  await withFixture(async (baseUrl, root) => {
    const manifest = await captureScreens({ baseUrl, root, fixture: true, plan,
      fixtureCredentials: { email: 'fixture@example.test', password: 'fixture-password' },
      fixtureOnRequestFailed: () => { throw playwrightError; },
      fixtureBeforeStep: (step) => { if (step.label === 'Segundo') throw playwrightError; } });
    assert.deepEqual(manifest.entries.map((entry) => entry.label), ['Primeiro', 'Terceiro']);
    assert.ok(manifest.pending?.some((item) => item.includes('Segundo')));
  });
});

test('log elimina headers, sessão, Bearer e call log do Playwright', () => {
  const log = captureFailureLog(new Error(`TimeoutError: cookie: .AspNetCore.Identity.Application=${secret} authorization: Bearer eyJhbGciOiJIUzI1NiJ9.fixture.signature\nCall log:\n${playwrightError.message}`));
  assert.match(log, /TimeoutError/u);
  assert.doesNotMatch(log, /CfDJ8|AspNetCore|cookie|authorization|Bearer|eyJhb|Call log|fixture\.signature/iu);
});
