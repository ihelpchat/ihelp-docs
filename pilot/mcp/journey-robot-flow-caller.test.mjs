import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { recordJourneys } from './journey-runtime.mjs';

async function withFlowCaller(t, flowMode, consume) {
  const origin = 'https://front.example.test';
  const root = await mkdtemp(join(tmpdir(), 'robot-flow-caller-'));
  const requests = [], browsers = [], composed = [];
  const authorization = 'Bearer fixture.' + Buffer.from(JSON.stringify({ userId: '3', businessId: '42' }))
    .toString('base64url') + '.fixture';
  let bot, saved = false;
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
      if (req.method === 'PUT' && url.pathname === '/api/v2/bot/own-17/save') {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const data = JSON.parse(raw);
        assert.equal(data.status, false);
        assert.equal(data.botEvents.length, 3);
        assert.ok(data.botEvents[0].message.startsWith('Teste FAQ '));
        assert.ok(data.botEvents[0].botReactionRules.every(rule => rule.message.startsWith('Teste FAQ ')));
        bot = { ...bot, ...data, dateLastChange: new Date(Date.now() + 1).toISOString() }; saved = true;
        return json({ dados: { bot } });
      }
      if (req.method === 'DELETE') return json({});
      if (url.pathname === '/api/v2/company') return json({ dados: { id: 42 } });
      if (url.pathname === '/api/v2/bot/own-17') {
        const snapshot = structuredClone(bot);
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
    else if (url.pathname === '/bot/own-17' && saved) html = `<main><h1>${bot.title}</h1><a href="#flow">Fluxo de Robô</a><section id="graph">${flowMode === 'delayed' ? '<svg width="20" height="20"><title>Carregando</title><rect width="20" height="20"/></svg>' : ''}</section></main>
      <script>if (${JSON.stringify(flowMode)} === 'delayed') setTimeout(() => {
        document.querySelector('#graph').innerHTML='<div class="react-flow__viewport" style="width:300px;height:100px">Menu de opções</div>';
      }, 6000);</script>`;
    else if (url.pathname === '/bot/own-17') html = `<main><h1>${bot.title}</h1><a href="#flow">Fluxo de Robô</a><button id="add">Adicionar bloco</button><button id="save">Salvar</button><div class="react-flow__viewport" style="width:300px;height:100px"></div><section class="custom-height-sidebar"></section></main>
      <script>${bootstrap}
      const sidebar=document.querySelector('section');let additions=0,question='',options=[];const messages=[];
      const choices=()=>{sidebar.innerHTML='<button id="menu">Menu de opções</button><button id="simple">Mensagem simples</button>';
        document.querySelector('#menu').onclick=()=>{sidebar.innerHTML='<input placeholder="Mensagem de onboarding"><input placeholder="Mensagem"><button id="option">Adicionar opção +</button><div id="options"></div>';document.querySelector('#option').onclick=()=>{const input=document.createElement('input');input.placeholder='Adicione uma opção';document.querySelector('#options').append(input);};};
        document.querySelector('#simple').onclick=()=>{sidebar.innerHTML='<input placeholder="Título da mensagem"><div><textarea></textarea><button id="compose"><svg width="20" height="20"><rect width="20" height="20"/></svg></button></div>';
          document.querySelector('#compose').onclick=()=>{const text=document.querySelector('textarea').value;messages.push({title:document.querySelector('input').value,text});console.log('fixture-composed:'+text);sidebar.replaceChildren();};
        };
      };
      document.querySelector('#add').onclick=()=>{additions++;if(additions===2){question=document.querySelector('[placeholder="Mensagem"]').value;options=[...document.querySelectorAll('#options input')].map(n=>n.value);sidebar.replaceChildren();}else choices();};
      document.querySelector('#save').onclick=async()=>{
        const botEvents=[{idRef:'menu-ref',type:1,botId:17,title:'Menu de opções',message:question,
          botReactionRules:options.map((message,i)=>({idRef:'rule-'+(i+1),botEventRedirectRef:'message-'+(i+1),rule:i+1,botId:17,message}))},
          ...messages.map((message,i)=>({idRef:'message-'+(i+1),type:0,botId:17,title:message.title,groupBlockId:String(i+1).repeat(24),messages:[{type:0,message:message.text}]}))];
        const response=await fetch('/api/v2/bot/own-17/save',{method:'PUT',headers:{...headers,'content-type':'application/json'},
          body:JSON.stringify({id:17,idRef:'own-17',empresaId:42,title:${JSON.stringify(bot?.title)},status:false,type:1,botTrigger:1,botEvents})});
        await response.json();if(response.ok)location.reload();
      };
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
      'Mensagem', 'Adicionar opção +', 'Adicione uma opção', 'Título da mensagem', 'Enviar mensagem', 'Salvar'];
    const records = await recordJourneys('robos', ['robos.criar', 'robos.montar_menu'], { root,
      env: { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: origin + '/',
        QA_PROD_ALLOWED_HOSTS: 'front.example.test', QA_PROD_EMAIL: 'test@example.test',
        QA_PROD_PASSWORD: 'fictional', QA_PROD_COMPANY_ID: '42', QA_PROD_TEST_PHONE: '+44 20 7946 0001',
        CAPTURE_FRONT_SHA: 'a'.repeat(40) },
      preflight: async () => ({ mode: 'ready', companyId: '42', realCompany: true }),
      getProductContext: async () => ({ code: [{ role: 'frontend', available: true, ref: 'a'.repeat(40),
        screenFacts: labels.map(text => ({ text })), screenCode: [] }] }),
    });
    await consume({ records, requests, composed });
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

for (const mode of ['delayed', 'missing']) test(`caller real preserva catálogo Teste FAQ e exige fluxo após salvar: ${mode}`, async t => {
  await withFlowCaller(t, mode, async ({ records, requests, composed }) => {
    assert.equal(records[0].status, 'concluída', JSON.stringify(records[0]));
    assert.equal(composed.length, 2, JSON.stringify(records.map(({task,status,reason,actions,actionError,observeError})=>({task,status,reason,actions,actionError,observeError}))));
    assert.deepEqual(requests.filter(r => r.method !== 'GET'), [
      {method:'POST',path:'/api/v2/bot'}, {method:'PUT',path:'/api/v2/bot/own-17/save'}, {method:'DELETE',path:'/api/v2/bot/own-17'},
    ], 'só POST próprio inativo, PUT próprio e DELETE do mesmo registro');
    const menu = records.find(r => r.task === 'robos.montar_menu');
    if (mode === 'delayed') assert.equal(menu.status, 'concluída', JSON.stringify({status:menu.status,reason:menu.reason,verification:menu.verification,observeError:menu.observeError,actionError:menu.actionError}));
    else assert.notEqual(menu.status, 'concluída', 'backend salvo e cabeçalho pronto não substituem o fluxo que nunca renderizou');
    assert.deepEqual(records.cleanup.pending, []);
    assert.deepEqual(records.cleanup.created, records.cleanup.deleted);
    assert.equal(records.cleanup.created.length, 1);
  });
});
