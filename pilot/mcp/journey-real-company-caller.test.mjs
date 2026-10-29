import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { recordJourneys } from './journey-runtime.mjs';
import { screenshotForStep } from './screen-capture-manifest.mjs';
import { chooseScreenshot } from '../scripts/screen-capture/capture.mjs';

const origin = 'https://front.example.test';
const env = { QA_TARGET: 'producao', QA_PROD_ENABLED: 'true', QA_PROD_URL: origin + '/',
  QA_PROD_ALLOWED_HOSTS: 'front.example.test', QA_PROD_EMAIL: 'test@example.test',
  QA_PROD_PASSWORD: 'fictional', QA_PROD_COMPANY_ID: '42', QA_PROD_TEST_PHONE: '+44 20 7946 0001',
  CAPTURE_FRONT_SHA: 'a'.repeat(40) };
const labels = ['Contatos', 'Adicionar Contato', 'Nome', 'Telefone', 'Salvar', 'Buscar contato...', 'Tags'];

// Exercise recordJourneys -> lazy browser -> makeBrowser, login and network policy unchanged.
// Only the transport is redirected: route.fetch reaches loopback instead of a real account.
async function withFront(t, options, consume) {
  const root = await mkdtemp(join(tmpdir(), 'journey-real-caller-'));
  const requests = [];
  const browsers = [];
  let saved;
  let tag;
  let linked = false;
  const token = () => 'fixture.' + Buffer.from(JSON.stringify({ userId: '3',
    businessId: saved && options.tokenCompany || '42' })).toString('base64url') + '.fixture';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    requests.push({ method: req.method, path: url.pathname, search: url.search });
    const json = (body, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
    };
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'DELETE') { setTimeout(() => json({}, 200), 25); return; }
      if (req.method === 'POST' && url.pathname === '/api/v2/contacts') {
        let body = ''; for await (const chunk of req) body += chunk;
        const part = name => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]+)`, 'u').exec(body)?.[1];
        const contact = JSON.parse(part('contato'));
        saved = { id: 17, ...(options.noId ? {} : { idRef: 'created-17' }), nome: contact.nome,
          telefone: env.QA_PROD_TEST_PHONE };
        return json({ dados: saved }, 201);
      }
      if (url.pathname === '/api/v2/company') return json({ dados: {
        id: options.initialCompany ?? (saved && options.company || 42) } });
      if (req.method === 'POST' && url.pathname === '/api/v2/tags') {
        let body = ''; for await (const chunk of req) body += chunk;
        tag = { id: 33, nome: JSON.parse(body).nome };
        linked = true;
        // TagsController.PostTags(contactId) returns ContactsTag, not the Tag entity.
        return json({ dados: { id: 733, contatoId: options.tagContactId ?? 17,
          tagsId: tag.id, empresaId: options.tagCompanyId ?? 42 } }, 200);
      }
      if (req.method === 'POST' && url.pathname === '/api/v2/contactTags/17') { linked = true; return json({}); }
      if (url.pathname === '/api/v2/contactTags/getContactsTagByContactId/17') return json(linked ? [{ tagsId: tag.id }] : []);
      if (url.pathname.startsWith('/api/v2/contacts/details/')) return json({ dados: saved });
      if (url.pathname === '/api/v2/contacts') return json({ dados: url.searchParams.has('searchData')
        ? [saved] : [{ id: 99, idRef: 'unrelated-99', nome: 'Cliente fictício anterior' }] });
      return json(url.pathname === '/api/v2/tags' ? tag ? [tag] : [] : { dados: [] });
    }
    const script = `
      const headers = { Authorization: ${JSON.stringify('Bearer ' + token())} };
      const get = path => fetch('/api/v2' + path, { headers }).then(r => r.json());
    `;
    let html;
    if (url.pathname === '/login') html = `<input type="email"><input type="password"><button>Entrar</button>
      <script>document.querySelector('button').onclick = () => location.href = '${options.preflightRequests
    ? '/contact?bootstrap=1' : '/contact'}';</script>`;
    else if (url.pathname.startsWith('/contact/detail/')) {
      html = `<main><h1>Contatos</h1><div id="name"></div><div>${env.QA_PROD_TEST_PHONE}</div>
        ${options.tags ? '<button role="tab" id="tags">Tags</button><div id="tag-form" hidden><input role="combobox" placeholder="Buscar ou criar tag..."><div id="options"></div></div>' : ''}</main>
        <script>${script}
          // Initial loading render is replaced by the caller's reload; only that fresh read renders the record.
          if (performance.getEntriesByType('navigation')[0]?.type === 'reload') get('/contacts/details/' + location.pathname.split('/').pop()).then(data => {
            document.querySelector('#name').textContent = data.dados.nome;
          });
          ${options.tags ? `
            document.querySelector('#tags').onclick = () => { document.querySelector('#tag-form').hidden = false; };
            document.querySelector('[role=combobox]').oninput = event => {
              const name = event.target.value;
              const option = document.createElement('div'); option.setAttribute('role', 'option'); option.textContent = name;
              option.onclick = async () => {
                await fetch('/api/v2/tags?contactId=17', {method:'POST',
                  headers: {...headers, 'content-type':'application/json'}, body:JSON.stringify({nome:name})}).then(r => r.json());
                // ContactInformations.handleCreateTag refreshes both lists, then reads the linked IDs again.
                await Promise.all([get('/tags'), get('/contactTags/getContactsTagByContactId/17')]);
                const links = await get('/contactTags/getContactsTagByContactId/17');
                await fetch('/api/v2/contactTags/17', {method:'POST', headers: {...headers, 'content-type':'application/json'},
                  body:JSON.stringify(links.map(row => ({contatoId:17, tagsId:row.tagsId})))});
              };
              document.querySelector('#options').replaceChildren(option);
            };
          ` : ''}
        </script>`;
    }
    else html = `<main>${options.inactiveBackground ? '<section id="background">' : ''}<h1>Contatos</h1><button id="add">Adicionar Contato</button>
      <input placeholder="Buscar contato..."><table><tbody></tbody></table>
      ${options.inactiveBackground ? '<input type="checkbox">'.repeat(24) + '</section>' : ''}
      <form hidden><label>Nome<input name="nome"></label><label>Telefone<input name="telefone"></label><button>Salvar</button></form></main>
      <script>${script}
        ${options.backgroundGets ? `
          new EventSource('/api/v2/notifications/sse/connect?access_token=fixture-secret');
          new EventSource('/api/v2/crm/sse/connect?access_token=fixture-secret');
          get('/sync/calls').catch(() => {});
          get('/sync/basic-infos').catch(() => {});
        ` : ''}
        const render = data => { document.querySelector('tbody').innerHTML = data.dados.map(row => '<tr><td>' + row.nome + '</td></tr>').join(''); };
        const loadContacts = () => get('/contacts?page=1&limit=1').then(render);
        ${options.preflightRequests ? `
          if (location.search === '?bootstrap=1') {
            Promise.allSettled([
              get('/contacts?page=1&limit=20'),
              fetch('/api/v2/startup/blocked', {method:'POST', headers, body:'fixture-secret'}),
              fetch('/api/v2/contacts/unrelated-99', {method:'DELETE', headers}),
            ]).then(loadContacts);
          } else loadContacts();
        ` : 'loadContacts();'}
        document.querySelector('#add').onclick = () => { document.querySelector('form').hidden = false;
          ${options.inactiveBackground ? "document.querySelector('#background').setAttribute('inert', ''); document.querySelector('#background').setAttribute('aria-hidden', 'true');" : ''}
        };
        document.querySelector('[placeholder]').oninput = event => {
          clearTimeout(window.timer); const value = event.target.value;
          window.timer = setTimeout(() => get('/contacts?searchData=' + encodeURIComponent(value)).then(render), ${options.filterDebounceMs ?? 50});
        };
        document.querySelector('form').onsubmit = async event => {
          event.preventDefault();
          const form = new FormData(); form.set('contato', JSON.stringify({
            nome: document.querySelector('[name=nome]').value,
            contatoTelefones: [{numero: document.querySelector('[name=telefone]').value, tipoTelefone: 1}]
          }));
          await fetch('/api/v2/contacts', {method:'POST', headers, body:form});
        };
        ${options.unownedDetail ? "history.replaceState(null, '', '/contact/detail/unrelated-99');" : ''}
      </script>`;
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
  });
  let launchMock; let fetchMock;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const local = `http://127.0.0.1:${server.address().port}`;
    const realLaunch = chromium.launch.bind(chromium);
    launchMock = t.mock.method(chromium, 'launch', async (...args) => {
      const browser = await realLaunch(...args); browsers.push(browser);
      const newContext = browser.newContext.bind(browser);
      t.mock.method(browser, 'newContext', async (...args) => {
        const context = await newContext(...args);
        const register = context.route.bind(context);
        t.mock.method(context, 'route', (pattern, handler, ...args) => register(pattern, route => handler(new Proxy(route, {
          get(target, key) {
            if (key === 'fetch') return fetchOptions => {
              const request = route.request(); const url = new URL(request.url());
              assert.equal(url.origin, origin, 'nenhuma requisição sai para serviço remoto');
              return context.request.fetch(local + url.pathname + url.search, { ...fetchOptions,
                method: request.method(), headers: request.headers(), data: request.postDataBuffer() ?? undefined });
            };
            const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
          },
        })), ...args));
        return context;
      });
      return browser;
    });
    const realFetch = globalThis.fetch;
    fetchMock = t.mock.method(globalThis, 'fetch', (url, options) => {
      assert.equal(String(url), origin, 'probe só consulta o front falso');
      return realFetch(local, options);
    });
    const run = tasks => recordJourneys('contatos', tasks, { root, env,
      preflight: async () => ({ mode: 'ready', companyId: '42', realCompany: true }),
      getProductContext: async () => ({ code: [{ role: 'frontend', available: true, ref: 'a'.repeat(40),
        screenFacts: labels.map(text => ({ text })), screenCode: [] }] }),
      // Stop after one observation through a refused decision, without executing a browser action.
      ...(options.unownedDetail ? { model: { async decide() { return { type: 'press' }; } } } : {}),
      ...(options.inactiveBackground ? { model: { async decide() {
        throw new Error('fixture: o plano determinístico precisa enxergar os campos ativos');
      } } } : {}),
    });
    await consume({ run, root, requests });
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

test('caller real conclui contato com tabela inativa atrás do formulário', async t => {
  await withFront(t, { inactiveBackground: true }, async ({ run, requests }) => {
    const records = await run(['contatos.cadastrar']);
    assert.deepEqual(records.map(({ status }) => status), ['concluída'],
      JSON.stringify(records.map(({ status, reason, actionError }) => ({ status, reason, actionError }))));
    assert.ok(records[0].actions.some(a => a.type === 'fill' && a.name === 'Nome'));
    assert.ok(records[0].actions.some(a => a.type === 'fill' && a.name === 'Telefone'));
    assert.equal(requests.filter(({ method, path }) => method === 'POST' && path === '/api/v2/contacts').length, 1);
    assert.deepEqual(records.cleanup.deleted, [{ kind: 'contact', id: 'created-17' }]);
    assert.deepEqual(records.cleanup.pending, []);
  });
});

test('caller real mantém GETs automáticos abortados e conclui apenas o contato próprio', async t => {
  await withFront(t, { backgroundGets: true }, async ({ run, requests }) => {
    const records = await run(['contatos.cadastrar']);
    assert.deepEqual(records.map(({ status }) => status), ['concluída'],
      JSON.stringify(records.map(({ status, reason, blocked, backgroundDenied }) =>
        ({ status, reason, blocked, backgroundDenied }))));
    const paths = ['/api/v2/notifications/sse/connect', '/api/v2/crm/sse/connect',
      '/api/v2/sync/calls', '/api/v2/sync/basic-infos'];
    for (const path of paths) {
      assert.ok(records[0].backgroundDenied[path] >= 1, `negação precisa ficar registrada: ${path}`);
      assert.equal(requests.some((request) => request.path === path), false,
        `GET com efeito não pode alcançar o servidor: ${path}`);
    }
    assert.equal(requests.filter(({ method, path }) => method === 'POST' && path === '/api/v2/contacts').length, 1);
    assert.deepEqual(records.cleanup.deleted, [{ kind: 'contact', id: 'created-17' }]);
    assert.deepEqual(records.cleanup.pending, []);
    assert.equal(JSON.stringify(records[0].backgroundDenied).includes('fixture-secret'), false);
  });
});

test('caller real mantém inicialização negada sem contaminar contato próprio', async t => {
  await withFront(t, { preflightRequests: true }, async ({ run, requests }) => {
    const records = await run(['contatos.cadastrar']);
    assert.deepEqual(records.map(({ status }) => status), ['concluída'],
      JSON.stringify(records.map(({ status, reason, blocked, preflightDenied }) =>
        ({ status, reason, blocked, preflightDenied }))));
    for (const key of ['GET:fetch', 'POST:fetch', 'DELETE:fetch'])
      assert.ok(records[0].preflightDenied?.[key] >= 1, `negação precisa ficar registrada: ${key}`);
    assert.equal(requests.some(({ path, search }) => path === '/api/v2/contacts' && search.includes('limit=20')), false);
    assert.equal(requests.some(({ path }) => ['/api/v2/startup/blocked', '/api/v2/contacts/unrelated-99'].includes(path)), false);
    assert.equal(requests.filter(({ method, path }) => method === 'POST' && path === '/api/v2/contacts').length, 1);
    assert.deepEqual(records.cleanup.deleted, [{ kind: 'contact', id: 'created-17' }]);
    assert.deepEqual(records.cleanup.pending, []);
  });
});

test('caller real impede cadastro se empresa divergir após inicialização negada', async t => {
  await withFront(t, { preflightRequests: true, initialCompany: 43 }, async ({ run, requests }) => {
    const records = await run(['contatos.cadastrar']);
    assert.notEqual(records[0].status, 'concluída');
    assert.equal(records[0].actions.length, 0);
    assert.equal(requests.filter(({ method }) => ['POST', 'DELETE', 'PATCH', 'PUT'].includes(method)).length, 0);
    assert.deepEqual(records.cleanup, { created: [], deleted: [], pending: [] });
  });
});

test('caller real nega lista sem filtro, captura lista filtrada pendente e limpa só ID da resposta', async t => {
  await withFront(t, { filterDebounceMs: 500 }, async ({ run, root, requests }) => {
    const records = await run(['contatos.buscar']);
    assert.deepEqual(records.map(record => record.status), ['concluída', 'concluída'],
      JSON.stringify({ records: records.map(({ status, reason, blocked, verification, creationCapture }) =>
        ({ status, reason, blocked, verification, creationCapture })), cleanup: records.cleanup, requests }));
    const screens = records.flatMap(record => record.screens);
    assert.equal(screens[0].screenshotId, null, 'makeBrowser não captura lista sem filtro');
    assert.match(screens[0].screenshotReason, /filtro Teste FAQ ausente/u);
    const filtered = records[1].screens.find(screen => screen.screenshotId);
    assert.ok(filtered, 'fill do caller deve armar o guard antes do GET filtrado');
    assert.equal(filtered.aprovacao, 'pendente');
    assert.ok((await readFile(join(root, 'contatos', `${filtered.screenshotId}.png`))).length > 100);
    const stored = JSON.parse(await readFile(join(root, 'contatos', `${records[1].task}.${records[1].cacheKey}.json`)));
    assert.equal(stored.screens.find(screen => screen.screenshotId).aprovacao, 'pendente');
    const entry = { page: 'contatos', step: 'buscar', source: 'automatic', status: 'approved', aprovacao: filtered.aprovacao,
      file: `/img/mcp/contatos/buscar.automatic.${filtered.screenshotId}.png`, sha256: filtered.screenshotId,
      bundleSha: 'a'.repeat(40), alt: 'Contatos' };
    const approved = { version: 1, entries: [{ ...entry, aprovacao: 'aprovado' }] };
    assert.ok(screenshotForStep(approved, 'contatos', 'buscar'), 'controle aprovado é publicável');
    assert.ok(chooseScreenshot(approved, 'contatos', 'buscar'));
    assert.equal(screenshotForStep({ version: 1, entries: [entry] }, 'contatos', 'buscar'), null);
    assert.equal(chooseScreenshot({ version: 1, entries: [entry] }, 'contatos', 'buscar'), null);
    assert.deepEqual(records.cleanup.deleted, [{ kind: 'contact', id: 'created-17' }],
      'limpeza deve apagar exatamente o ID da resposta');
    assert.deepEqual(records.cleanup.pending, []);
    assert.deepEqual(requests.filter(req => req.method === 'DELETE'),
      [{ method: 'DELETE', path: '/api/v2/contacts/created-17', search: '' }]);
    const report = (await readdir(root)).find(file => file.startsWith('cleanup-'));
    assert.deepEqual(JSON.parse(await readFile(join(root, report))), records.cleanup);
  });
});

test('caller real nega ficha de registro que não pertence à execução', async t => {
  await withFront(t, { unownedDetail: true }, async ({ run, requests }) => {
    const [record] = await run(['contatos.cadastrar']);
    assert.equal(record.status, 'bloqueada');
    assert.equal(record.reason, 'ação proibida');
    assert.equal(record.screens.length, 1);
    assert.equal(record.screens[0].path, '/contact/detail/record');
    assert.equal(record.screens[0].screenshotId, null, 'ficha alheia não pode gerar print no caller');
    assert.match(record.screens[0].screenshotReason, /sem item próprio/u);
    assert.deepEqual(requests.filter(req => req.method === 'DELETE'), []);
  });
});

test('caller real deixa resposta sem ID pendente, sem DELETE ou busca de nome para limpeza', async t => {
  await withFront(t, { noId: true }, async ({ run, requests }) => {
    const records = await run(['contatos.cadastrar']);
    assert.equal(records[0].creationCapture.postSeen, true);
    assert.equal(records[0].creationCapture.status, 201);
    assert.equal(records[0].creationCapture.refFound, false);
    assert.deepEqual(records.cleanup.created, [{ kind: 'contact', id: null }]);
    assert.deepEqual(records.cleanup.deleted, []);
    assert.deepEqual(records.cleanup.pending, [{ kind: 'contact', reason: 'id de resposta ausente' }]);
    assert.deepEqual(requests.filter(req => req.method === 'DELETE' || req.search.includes('searchData')), []);
  });
});

test('caller real captura ID da resposta de tag Teste FAQ e limpa tag antes do contato', async t => {
  await withFront(t, { tags: true }, async ({ run, requests }) => {
    const records = await run(['contatos.marcar_tags']);
    assert.equal(records[0].status, 'concluída', 'cadastro precisa concluir antes da prova de tag');
    assert.equal(records[1].tagProbe?.createdTagIdCaptured, true,
      'ID da tag deve vir da resposta antes do vínculo');
    assert.deepEqual(records.map(record => record.status), ['concluída', 'concluída'],
      JSON.stringify(records.map(({ status, reason, blocked, verification }) => ({ status, reason, blocked, verification }))));
    assert.deepEqual(records.cleanup.deleted, [{ kind: 'tag', id: 33 }, { kind: 'contact', id: 'created-17' }]);
    assert.deepEqual(records.cleanup.created, [{ kind: 'tag', id: 33 }, { kind: 'contact', id: 'created-17' }],
      'relatório deve preservar os IDs das respostas desta execução');
    assert.deepEqual(records.cleanup.pending, []);
    assert.deepEqual(requests.filter(req => req.method === 'DELETE').map(req => req.path),
      ['/api/v2/tags/33', '/api/v2/contacts/created-17']);
  });
});

for (const [source, options] of [['contato', { tagContactId: 99 }], ['empresa', { tagCompanyId: 43 }]]) {
  test(`caller real recusa resposta de tag com ${source} divergente`, async t => {
    await withFront(t, { tags: true, ...options }, async ({ run, requests }) => {
      const records = await run(['contatos.marcar_tags']);
      assert.ok(requests.some(req => req.method === 'POST' && req.path === '/api/v2/tags'),
        'a prova precisa alcançar a criação de tag');
      assert.ok(records.cleanup.pending.some(item => item.kind === 'tag' && item.reason === 'id de resposta ausente'));
      assert.deepEqual(records.cleanup.deleted.filter(item => item.kind === 'tag'), []);
      assert.deepEqual(requests.filter(req => req.method === 'DELETE' && req.path.startsWith('/api/v2/tags/')), []);
    });
  });
}

for (const [source, options] of [['empresa', { company: 43 }], ['token', { tokenCompany: '43' }]]) {
  test(`caller real recusa cleanup com ${source} divergente após criação`, async t => {
    await withFront(t, options, async ({ run, requests }) => {
      const records = await run(['contatos.cadastrar']);
      assert.equal(records[0].status, 'concluída');
      assert.deepEqual(records.cleanup.deleted, [], 'empresa ou token divergente nunca autoriza limpeza');
      assert.deepEqual(records.cleanup.pending, [{ kind: 'contact', id: 'created-17', reason: 'limpeza indisponível' }]);
      assert.deepEqual(requests.filter(req => req.method === 'DELETE'), [], 'empresa divergente nunca autoriza DELETE');
    });
  });
}
