import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { recordJourneys } from './journey-runtime.mjs';

async function withDraftCaller(t, changedBeforeClick, consume) {
  const origin = 'https://front.example.test';
  const root = await mkdtemp(join(tmpdir(), 'robot-draft-caller-'));
  const requests = [], browsers = [], composed = [];
  const authorization = 'Bearer fixture.' + Buffer.from(JSON.stringify({ userId: '3', businessId: '42' }))
    .toString('base64url') + '.fixture';
  let bot, draftReady = false, guardReads = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    requests.push({ method: req.method, path: url.pathname });
    const json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST' && url.pathname === '/api/v2/bot') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        assert.equal(data.status, false);
        bot = { ...data, id: 17, idRef: 'own-17', empresaId: 42, botEvents: [], dateLastChange: new Date().toISOString() };
        return json({ dados: bot }, 201);
      }
      if (req.method === 'DELETE') return json({});
      if (url.pathname === '/api/v2/company') return json({ dados: { id: 42 } });
      if (url.pathname === '/api/v2/bot/own-17') {
        const snapshot = structuredClone(bot);
        if (draftReady) {
          guardReads++;
          // The first authorization sees the inactive snapshot. Its next read must see this change.
          if (changedBeforeClick) bot.status = true;
        }
        return json({ dados: { bot: snapshot } });
      }
      if (url.pathname === '/api/v2/configurations/channels') return json({ dados: [{ id: 1 }] });
      if (url.pathname === '/api/v2/tags') return json([]);
      return json({ dados: [] });
    }
    const bootstrap = `const headers=${JSON.stringify({ Authorization: authorization })};`;
    let html;
    if (url.pathname === '/login') html = '<input type="email"><input type="password"><button onclick="location.href=\'/contact\'">Entrar</button>';
    else if (url.pathname === '/bot') html = `<main><input placeholder="Buscar robô"><button id="create">Criar novo robô</button>
      <form hidden><input placeholder="Título do Robô"><button type="button">Canais</button><div role="combobox" aria-label="Canais" tabindex="0">Canais</div><div role="option" data-value="1">Canal fictício</div><button>Adicionar robô</button></form></main>
      <script>${bootstrap}
      document.querySelector('#create').onclick=()=>document.querySelector('form').hidden=false;
      document.querySelector('form').onsubmit=async event=>{
        event.preventDefault();
        const created=await fetch('/api/v2/bot',{method:'POST',headers:{...headers,'content-type':'application/json'},
          body:JSON.stringify({title:document.querySelector('[placeholder="Título do Robô"]').value,type:1,
            botTrigger:1,botChannels:[{CanalId:1}],status:false})}).then(response=>response.json());
        // React Router preserves the document and its completed POST response.
        history.pushState(null,'','/bot/'+created.dados.idRef);
        const heading=document.createElement('h1');heading.textContent=created.dados.title;
        const flow=document.createElement('a');flow.href='#flow';flow.textContent='Fluxo de Robô';
        document.querySelector('main').replaceChildren(heading,flow);
      };
      </script>`;
    else if (url.pathname === '/bot/own-17') html = `<main><h1>${bot.title}</h1><a href="#flow">Fluxo de Robô</a><button id="add">Adicionar bloco</button><section class="custom-height-sidebar"></section></main>
      <script>${bootstrap}
      const sidebar=document.querySelector('section');let additions=0;
      const choices=()=>{sidebar.innerHTML='<button id="menu">Menu de opções</button><button id="simple">Mensagem simples</button>';
        document.querySelector('#menu').onclick=()=>{sidebar.innerHTML='<input placeholder="Mensagem de onboarding"><input placeholder="Mensagem"><button id="option">Adicionar opção +</button><div id="options"></div>';document.querySelector('#option').onclick=()=>{const input=document.createElement('input');input.placeholder='Adicione uma opção';document.querySelector('#options').append(input);};};
        document.querySelector('#simple').onclick=()=>{sidebar.innerHTML='<input placeholder="Título da mensagem"><div><textarea></textarea><button id="compose"><svg width="20" height="20"><rect width="20" height="20"/></svg></button></div>';
          document.querySelector('textarea').oninput=()=>console.log('fixture-draft-ready');
          document.querySelector('#compose').onclick=()=>{console.log('fixture-composed:'+document.querySelector('textarea').value);document.querySelector('#add').remove();sidebar.replaceChildren();};
        };
      };
      document.querySelector('#add').onclick=()=>{additions++;if(additions===2)sidebar.replaceChildren();else choices();};
      </script>`;
    else html = `<main>Contatos</main><script>${bootstrap}fetch('/api/v2/contacts?page=1&limit=1',{headers});</script>`;
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
          if (msg.text() === 'fixture-draft-ready') draftReady = true;
          if (msg.text().startsWith('fixture-composed:')) composed.push(msg.text().slice('fixture-composed:'.length));
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
    const labels = ['Robôs', 'Criar novo robô', 'Buscar robô', 'Título do Robô', 'Canais', 'Adicionar robô',
      'Fluxo de Robô', 'Adicionar bloco', 'Menu de opções', 'Mensagem simples', 'Mensagem de onboarding',
      'Mensagem', 'Adicionar opção +', 'Adicione uma opção', 'Título da mensagem', 'Enviar mensagem'];
    const records = await recordJourneys('robos', ['robos.criar', 'robos.montar_menu'], { root,
      env: { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: origin + '/',
        QA_PROD_ALLOWED_HOSTS: 'front.example.test', QA_PROD_EMAIL: 'test@example.test',
        QA_PROD_PASSWORD: 'fictional', QA_PROD_COMPANY_ID: '42', QA_PROD_TEST_PHONE: '+44 20 7946 0001',
        CAPTURE_FRONT_SHA: 'a'.repeat(40) },
      preflight: async () => ({ mode: 'ready', companyId: '42', realCompany: true }),
      getProductContext: async () => ({ code: [{ role: 'frontend', available: true, ref: 'a'.repeat(40),
        screenFacts: labels.map(text => ({ text })), screenCode: [] }] }),
    });
    await consume({ records, requests, composed, guardReads });
  } finally {
    try { await Promise.all(browsers.map(browser => browser.close())); }
    finally {
      fetchMock?.mock.restore(); launchMock?.mock.restore();
      server.closeAllConnections();
      try { await new Promise(resolve => server.close(resolve)); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  }
}

for (const changed of [false, true]) test(`caller Robôs revalida estado inativo no clique: mudança=${changed}`, async t => {
  await withDraftCaller(t, changed, async ({ records, requests, composed, guardReads }) => {
    assert.equal(records[0].status, 'concluída', JSON.stringify(records[0]));
    const menu = records.find(record => record.task === 'robos.montar_menu');
    assert.equal(composed.length, changed ? 0 : 1, JSON.stringify({ menu, composed }));
    assert.equal(menu.actions.filter(action => action.name === 'Enviar mensagem').length, changed ? 0 : 1);
    if (changed) {
      assert.equal(menu.status, 'bloqueada'); assert.equal(menu.reason, 'ação proibida');
      assert.ok(guardReads >= 2, 'o estado é relido antes do efeito');
    }
    else {
      assert.match(composed[0], /^Teste FAQ /u);
      // The fixture deliberately ends after its first local composition, with no model configured.
      assert.equal(menu.status, 'inconclusiva'); assert.equal(menu.reason, 'modelo');
      assert.equal(guardReads, 2, 'autorização e clique têm leituras próprias');
    }
    assert.deepEqual(records.cleanup.pending, []);
    assert.deepEqual(requests.filter(request => request.method !== 'GET'), [
      { method: 'POST', path: '/api/v2/bot' }, { method: 'DELETE', path: '/api/v2/bot/own-17' },
    ]);
  });
});
