import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as runtime from './journey-runtime.mjs';
import { runJourneys } from './journey-service.mjs';
import { captureMaskedFrame } from '../scripts/screen-capture/capture.mjs';
import { launch } from '../scripts/visual/measure.mjs';
import { reviewJourneyPrint } from '../scripts/review-journey-print.mjs';

const phone = '+44 20 7946 0001';

test('guard.capture mascara pixels opacos retornados e persistidos pela jornada real', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-integrated-mask-'));
  const path = '/contact/detail/record';
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<main><h1>Contatos</h1><canvas id="private" width="300" height="60"></canvas></main>');
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 500, height: 300 } });
    await page.goto(origin + path);
    await page.evaluate(() => {
      const ctx = document.getElementById('private').getContext('2d');
      ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 300, 60);
      ctx.fillStyle = 'black'; ctx.font = '16px sans-serif';
      ctx.fillText('Nome Fictício 02079460001', 8, 30);
    });
    // Decode the actual PNG, including the text area, rather than inspecting DOM overlays.
    const pixels = png => page.evaluate(async png => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const rect = document.getElementById('private').getBoundingClientRect();
      const data = ctx.getImageData(rect.x + 4, rect.y + 4, rect.width - 8, rect.height - 8).data;
      const counts = { red: 0, black: 0, masked: 0, total: data.length / 4 };
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0) counts.red++;
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0) counts.black++;
        if (data[i] === 226 && data[i + 1] === 232 && data[i + 2] === 240 && data[i + 3] === 255) counts.masked++;
      }
      return counts;
    }, png.toString('base64'));
    const unmasked = await pixels(await page.screenshot({ type: 'png' }));
    assert.ok(unmasked.red > 0 && unmasked.black > 0, 'controle sem máscara contém fundo e texto fictício visíveis');
    assert.equal(unmasked.masked, 0);

    const guard = runtime.createRealCompanyScreenshotGuard(page, () => origin);
    let captured;
    // Only the observation adapter is local: capture, sanitization, hashing and persistence are real.
    // The outer finally owns the browser and HTTP server, including failures inside the consumer.
    const [record] = await runJourneys({ root, module: 'contatos',
      tasks: [{ id: 'contatos.cadastrar', modulo: 'contatos', tarefa: 'Cadastrar',
        resultadoEsperadoObservavel: 'Contato fictício localizado' }],
      frontSha: 'a'.repeat(40), profile: 'qa', realCompany: true, testPhone: phone,
      cacheConfig: { qaTarget: 'producao' }, maxActionsPerTask: 1,
      browser: { async open() {}, async close() {}, async observe() {
        captured = await guard.capture({ path, ownItem: true, vocabulary: ['Contatos'], testPhone: phone });
        return { title: 'Contatos', path, controls: [], fields: [], messages: [], state: {}, ...captured };
      } }, model: { async decide() { return { type: 'finish' }; } } });
    assert.ok(Buffer.isBuffer(captured.screenshot), 'captura não pode ser omitida');
    assert.equal(captured.aprovacao, 'pendente');
    assert.equal(record.screens.length, 1);
    const stored = JSON.parse(await readFile(join(root, 'contatos', `${record.task}.${record.cacheKey}.json`), 'utf8'));
    const screen = stored.screens[0];
    assert.equal(screen.aprovacao, 'pendente');
    assert.equal(screen.screenshotId, createHash('sha256').update(captured.screenshot).digest('hex'));
    const persisted = await readFile(join(root, 'contatos', `${screen.screenshotId}.png`));
    assert.deepEqual(persisted, captured.screenshot, 'consumidor persiste os bytes devolvidos pelo guard');
    const returnedPixels = await pixels(captured.screenshot);
    assert.equal(returnedPixels.masked, unmasked.total, 'PNG retornado pelo guard mascara canvas e texto fictício fora da lista');
    const persistedPixels = await pixels(persisted);
    assert.equal(persistedPixels.masked, unmasked.total, 'PNG persistido pela jornada mantém a máscara integral');
  } finally {
    try { await browser?.close(); }
    finally {
      server.closeAllConnections();
      try { await new Promise(resolve => server.close(resolve)); }
      finally { await rm(root, { recursive: true, force: true }); }
    }
  }
});

test('lista com estrutura desconhecida nunca é confundida com lista vazia', async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    for (const html of [
      '<main><div role="list"><div>Cliente antigo</div></div></main>',
      '<main><div role="list">Cliente antigo</div></main>',
      '<main><div role="list"><div><div role="listitem">Teste FAQ Contato</div><article>Cliente antigo</article></div></div></main>',
      '<main><table><tbody><tr><td>Teste FAQ Contato</td></tr></tbody></table><div role="list"><div>Cliente antigo</div></div></main>',
      '<main><div data-testid="contactList"><article>Cliente antigo</article></div></main>',
    ]) {
      await page.setContent(html);
      assert.equal(await runtime.visibleRealCompanyRows(page), null, 'estrutura não verificável omite print');
    }
    await page.setContent('<main><table><tbody><tr><td><input type="checkbox"></td><td><span aria-hidden="true">TF</span><span>Teste FAQ Contato</span></td><td>20 7946 0001</td></tr></tbody></table></main>');
    assert.deepEqual(await runtime.visibleRealCompanyRows(page), ['Teste FAQ Contato 20 7946 0001'], 'avatar do front não é o nome da linha');
    await page.setContent('<main><h3>Nenhum resultado para os filtros aplicados</h3></main>');
    assert.deepEqual(await runtime.visibleRealCompanyRows(page), [], 'empty state conferido no front');
  } finally { await browser.close(); }
});

test('captura integra requisição observada, filtro digitado e DOM local', async (t) => {
  assert.equal(typeof runtime.createRealCompanyScreenshotGuard, 'function');
  const waiting = [];
  const html = `<main><input placeholder="Buscar contato..."><table><tbody><tr><td>Cliente antigo</td></tr></tbody></table></main>
    <script>
      window.readList = (path, render = true) => fetch(path).then(r => r.json()).then(data => {
        if (render) document.querySelector('tbody').innerHTML = data.map(name => '<tr><td>' + name + '</td></tr>').join('');
      });
      const input = document.querySelector('input');
      input.oninput = () => { clearTimeout(window.timer); window.timer = setTimeout(() => {
        window.loaded = window.readList('/api/v2/contacts?searchData=' + encodeURIComponent(input.value));
      }, 300); };
    </script>`;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url === '/busy') waiting.push({ path: req.url, reply(names = [], status = 200) {
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(names));
    } });
    else { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await launch();
    const setup = async () => {
      const page = await browser.newPage();
      await page.goto(`${origin}/contacts`);
      const guard = runtime.createRealCompanyScreenshotGuard(page, () => origin);
      const capture = () => guard.capture({ path: '/contacts', vocabulary: [], testPhone: phone });
      const start = async (value = 'Teste FAQ') => {
        guard.filterStarted({ type: 'fill', name: 'Buscar contato...', value });
        await page.getByPlaceholder('Buscar contato...').fill(value);
      };
      const pending = async () => {
        await page.waitForRequest(url => url.url().includes('/api/') || url.url().endsWith('/busy'), { timeout: 5000 });
        // The server receipt is the barrier, independent of response/render completion.
        while (!waiting.length) await new Promise(resolve => setImmediate(resolve));
        return waiting.shift();
      };
      const release = async (entry, names, status = 200) => {
        const response = page.waitForResponse(response => new URL(response.url()).pathname + new URL(response.url()).search === entry.path);
        entry.reply(names, status);
        await (await response).finished();
        await page.waitForLoadState('networkidle');
      };
      return { page, guard, capture, start, pending, release };
    };
    await t.test('debounce e resposta filtrada não autorizam linhas antigas; lista filtrada gera print pendente', async () => {
      const f = await setup();
      try {
        assert.equal((await f.capture()).screenshot, null);
        const pending = f.pending();
        await f.start();
        assert.equal((await f.capture()).screenshot, null, 'campo digitado antes da resposta');
        const entry = await pending;
        await f.release(entry, ['Teste FAQ Contato']);
        await f.page.evaluate(() => { document.querySelector('tbody').innerHTML = '<tr><td>Teste FAQ Contato</td></tr><tr><td>Cliente antigo</td></tr>'; });
        assert.equal((await f.capture()).screenshot, null, 'resposta chegou, mas há linha antiga');
        await f.page.locator('tbody tr').last().evaluate(row => row.remove());
        const allowed = await f.capture();
        assert.ok(Buffer.isBuffer(allowed.screenshot));
        assert.equal(allowed.aprovacao, 'pendente');
        await f.page.locator('tbody').evaluate(body => { body.innerHTML = ''; });
        assert.ok((await f.capture()).screenshot, 'lista comprovadamente vazia');
        await f.page.evaluate(() => { document.querySelector('table').outerHTML = '<div role="list"><article>Cliente antigo</article></div>'; });
        assert.equal((await f.capture()).screenshot, null, 'sem linhas reconhecidas não significa vazia');
      } finally { await f.page.close(); }
    });
    await t.test('resposta anterior à digitação, parâmetro errado, outro recurso e erro HTTP não valem como filtro', async () => {
      for (const [path, status, before] of [
        ['/api/v2/contacts?searchData=Teste%20FAQ', 200, true],
        ['/api/v2/contacts?tag=Teste%20FAQ', 200, false],
        ['/api/v2/bot?searchData=Teste%20FAQ', 200, false],
        ['/api/v2/contacts?searchData=Teste%20FAQ', 500, false],
      ]) {
        const f = await setup();
        try {
          if (!before) f.guard.filterStarted({ type: 'fill', name: 'Buscar contato...', value: 'Teste FAQ' });
          // Set only the fixture's value; the request below is controlled separately.
          await f.page.locator('input').evaluate(input => { input.value = 'Teste FAQ'; });
          const pending = f.pending();
          const loaded = f.page.evaluate(path => window.readList(path), path);
          const entry = await pending;
          if (before) f.guard.filterStarted({ type: 'fill', name: 'Buscar contato...', value: 'Teste FAQ' });
          await f.release(entry, ['Teste FAQ Contato'], status);
          await loaded;
          assert.equal((await f.capture()).screenshot, null, path);
        } finally { await f.page.close(); }
      }
    });
    await t.test('resposta de outro filtro e rede ocupada impedem captura', async () => {
      const f = await setup();
      try {
        const pending = f.pending();
        await f.start();
        await f.release(await pending, ['Teste FAQ Contato']);
        await f.page.locator('input').evaluate(input => { input.value = 'Teste FAQ Outro'; });
        assert.equal((await f.capture()).screenshot, null, 'valor atual diverge da resposta');
        await f.page.locator('input').evaluate(input => { input.value = 'Teste FAQ'; });
        const busy = f.pending();
        const request = f.page.evaluate(() => fetch('/busy').then(r => r.json()));
        const entry = await busy;
        try {
          assert.equal((await f.capture()).screenshot, null, 'rede não ociosa');
        } finally { entry.reply(); await request; }
      } finally { await f.page.close(); }
    });
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('revisão recusa PNG alterado e mantém pendente o registro original', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-print-integrity-'));
  const id = createHash('sha256').update('original').digest('hex');
  try {
    await mkdir(join(root, 'contatos'));
    const file = join(root, 'contatos', 'journey.json');
    await writeFile(file, JSON.stringify({ screens: [{ screenshotId: id, aprovacao: 'pendente' }] }));
    await writeFile(join(root, 'contatos', `${id}.png`), 'alterado');
    await assert.rejects(reviewJourneyPrint({ root, screenshotId: id, decision: 'aprovado' }), /print divergente/u);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).screens[0].aprovacao, 'pendente');
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('máscara existente cobre variantes do telefone, nomes e áreas opacas no PNG', async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const values = ['+44 20 7946 0001', '442079460001', '(20) 7946-0001', '20 7946 0001', 'cliente@example.test', 'Nome Fictício'];
    await page.setContent('<main>' + values.map((value, i) => `<p id="v${i}" style="width:max-content">${value}</p>`).join('') +
      '<span id="avatar" aria-hidden="true" style="display:block;width:60px;height:30px;background:red">NF</span>' +
      '<table><tbody><tr><td id="knownName">Contatos</td></tr></tbody></table>' +
      '<canvas id="canvas" width="120" height="30"></canvas>' +
      `<img id="image" width="120" height="30" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='30'%3E%3Crect width='120' height='30' fill='red'/%3E%3C/svg%3E">` +
      '<div id="background" style="width:120px;height:30px;background-image:linear-gradient(red,red)"></div></main>');
    const png = await captureMaskedFrame(page, [...values.slice(0, 5), 'Contatos'], { realCompany: true, testPhone: phone });
    const ids = [...values.map((_, i) => `v${i}`), 'avatar', 'knownName', 'canvas', 'image', 'background'];
    const colors = await page.evaluate(async ({ png, ids }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return ids.map(id => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return [...ctx.getImageData(Math.floor(rect.x + 5), Math.floor(rect.y + 5), 1, 1).data].slice(0, 3);
      });
    }, { png: png.toString('base64'), ids });
    assert.deepEqual(colors, ids.map(() => [226, 232, 240]));
  } finally { await browser.close(); }
});
