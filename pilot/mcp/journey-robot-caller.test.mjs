import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { recordJourneys } from './journey-runtime.mjs';

test('caller Robôs aguarda controles após hidratação antes de clicar', async t => {
  const origin = 'https://front.example.test';
  const root = await mkdtemp(join(tmpdir(), 'robot-caller-ready-'));
  const requests = [], browsers = [];
  let clicked = 0;
  const authorization = 'Bearer fixture.' + Buffer.from(JSON.stringify({ userId: '3', businessId: '42' }))
    .toString('base64url') + '.fixture';
  const server = createServer((req, res) => {
    const url = new URL(req.url, origin);
    requests.push({ method: req.method, path: url.pathname });
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ dados: url.pathname === '/api/v2/company' ? { id: 42 } : [] }));
      return;
    }
    const headers = JSON.stringify({ Authorization: authorization });
    const html = url.pathname === '/login'
      ? `<input type="email"><input type="password"><button onclick="location.href='/contact'">Entrar</button>`
      : url.pathname === '/bot'
        ? `<main style="width:300px;height:300px"></main><script>
          // Only requested native frames advance hydration; no wall-clock race.
          const frame = window.requestAnimationFrame.bind(window); let count = 0;
          window.requestAnimationFrame = callback => frame(time => {
            if (++count === 8) {
              document.querySelector('main').innerHTML = '<input placeholder="Buscar robô"><button id="create">Criar novo robô</button>';
              document.querySelector('#create').onclick = () => console.log('fixture-robot-create-opened');
            }
            callback(time);
          });
        </script>`
        : `<main>Contatos</main><script>fetch('/api/v2/contacts?page=1&limit=1', {headers:${headers}});</script>`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  let launchMock, fetchMock;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    const launch = chromium.launch.bind(chromium);
    launchMock = t.mock.method(chromium, 'launch', async (...args) => {
      const browser = await launch(...args); browsers.push(browser);
      const newContext = browser.newContext.bind(browser);
      t.mock.method(browser, 'newContext', async (...options) => {
        const context = await newContext(...options);
        context.on('page', page => page.on('console', msg => {
          if (msg.text() === 'fixture-robot-create-opened') clicked++;
        }));
        const register = context.route.bind(context);
        t.mock.method(context, 'route', (pattern, handler, ...rest) => register(pattern, route => handler(new Proxy(route, {
          get(target, key) {
            if (key === 'fetch') return fetchOptions => {
              const request = route.request(), url = new URL(request.url());
              assert.equal(url.origin, origin, 'transporte limitado ao front fictício');
              return context.request.fetch(local + url.pathname + url.search, { ...fetchOptions,
                method: request.method(), headers: request.headers(), data: request.postDataBuffer() ?? undefined });
            };
            const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
          },
        })), ...rest));
        return context;
      });
      return browser;
    });
    const fetch = globalThis.fetch;
    fetchMock = t.mock.method(globalThis, 'fetch', (url, options) => {
      assert.equal(String(url), origin, 'nenhuma chamada a conta ou modelo real');
      return fetch(local, options);
    });
    const records = await recordJourneys('robos', ['robos.criar'], { root,
      env: { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: origin + '/',
        QA_PROD_ALLOWED_HOSTS: 'front.example.test', QA_PROD_EMAIL: 'test@example.test',
        QA_PROD_PASSWORD: 'fictional', QA_PROD_COMPANY_ID: '42', QA_PROD_TEST_PHONE: '+44 20 7946 0001',
        CAPTURE_FRONT_SHA: 'a'.repeat(40) },
      preflight: async () => ({ mode: 'ready', companyId: '42', realCompany: true }),
      getProductContext: async () => ({ code: [{ role: 'frontend', available: true, ref: 'a'.repeat(40),
        screenFacts: ['Robôs', 'Criar novo robô', 'Buscar robô'].map(text => ({ text })), screenCode: [] }] }),
      model: { async decide({ actions }) {
        // End the fixture through a denied action after the one UI effect under test.
        return actions.length ? { type: 'press', role: 'button', name: 'Terminar fixture', value: null }
          : { type: 'click', role: 'button', name: 'Criar novo robô', value: null };
      } },
    });
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].actions, [{ type: 'click', role: 'button', name: 'Criar novo robô', value: null }],
      JSON.stringify({ status: records[0].status, reason: records[0].reason }));
    assert.equal(clicked, 1, 'efeito DOM nativo confirma o clique após a hidratação');
    assert.equal(records[0].status, 'bloqueada');
    assert.equal(records[0].reason, 'ação proibida');
    assert.equal(requests.some(request => request.method !== 'GET'), false);
  } finally {
    try { await Promise.all(browsers.map(browser => browser.close())); }
    finally {
      fetchMock?.mock.restore(); launchMock?.mock.restore();
      server.closeAllConnections();
      try { await new Promise(resolve => server.close(resolve)); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  }
});
