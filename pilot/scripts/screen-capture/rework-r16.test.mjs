import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { capturePlan, captureScreens } from './capture.mjs';

const sha = 'a'.repeat(40);
const screenFacts = ['Mais opções', 'Importar Contatos'].map((text) => ({ kind: 'action', text,
  route: '/contact', owner: 'fixture', sha,
  ...(text === 'Mais opções' ? { opensMenuFor: 'Importar Contatos' } : {}) }));
const faqBody = '1. Clique em **Mais opções** e escolha **Importar Contatos**.';
const html = `<!doctype html><html><head><style>
body{margin:0;background:white;font:18px Arial} h1{position:absolute;left:80px;top:30px;margin:0}
svg{position:absolute;left:20px;top:36px} button{position:absolute;left:80px;top:100px;height:40px}
#menu{position:absolute;left:80px;top:145px;background:white} #menu button{position:static}
table{position:absolute;left:80px;top:220px} td{min-width:180px;height:30px}
</style></head><body><svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="rgb(18, 101, 180)"/></svg>
<h1>Contatos</h1><button onclick="document.getElementById('menu').hidden=false">Mais opções</button>
<div id="menu" hidden><button role="menuitem" onclick="fetch('/write')">Importar Contatos</button></div>
<p style="position:absolute;left:400px;top:30px;margin:0">3 contatos</p>
<p style="position:absolute;left:400px;top:70px;margin:0">Empresa Fictícia</p>
<p style="position:absolute;left:400px;top:110px;margin:0">cliente@example.com</p>
<table><thead><tr><th>Nome</th><th>Telefone</th></tr></thead><tbody><tr><td>Maria Teste</td><td>11988887777</td></tr></tbody></table>
</body></html>`;

function pixels(png, points) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const channels = png[25] === 6 ? 4 : 3;
  assert.equal(png[24], 8);
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const rows = [];
  let position = 0, previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[position++], row = Buffer.from(raw.subarray(position, position + stride)); position += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x], corner = x >= channels ? previous[x - channels] : 0;
      const predictor = left + up - corner;
      const paeth = [left, up, corner].reduce((best, value) =>
        Math.abs(predictor - value) < Math.abs(predictor - best) ? value : best, left);
      row[x] = (row[x] + [0, left, up, (left + up) >> 1, paeth][filter]) & 255;
    }
    rows.push(row); previous = row;
  }
  return points.map(([x, y]) => [...rows[y].subarray(x * channels, x * channels + 3)]);
}

test('fixture preserva interface e ícone, mascara dados em cinza e abre menu', { timeout: 90000 }, async () => {
  const plan = capturePlan({ page: 'fixture', module: 'Contatos', faqBody,
    coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }], screenFacts });
  assert.equal(plan[0].action, 'click', 'gatilho citado na mesma linha deve abrir o menu');
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.url === '/write') { writes++; response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r16-'));
  try {
    const result = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`,
      plan, root, fixture: true, vocabulary: ['CÓNTATOS', 'Nome', 'Telefone', 'MAIS  OPCOES', 'Importar Contatos', '{count} contatos', 'cliente@example.com'] });
    assert.deepEqual(result.steps.map((step) => step.status), ['capturado', 'capturado'], JSON.stringify(result.steps));
    const first = await readFile(join(root, 'fixture', result.entries[0].file.split('/').at(-1)));
    const second = await readFile(join(root, 'fixture', result.entries[1].file.split('/').at(-1)));
    const [icon, title, count, unknown, sensitive, data] = pixels(first,
      [[32, 48], [85, 47], [405, 38], [405, 78], [405, 118], [85, 260]]);
    assert.deepEqual(icon, [18, 101, 180], 'ícone da interface permanece visível');
    assert.notDeepEqual(title, [226, 232, 240], 'título da interface permanece visível');
    assert.notDeepEqual(count, [226, 232, 240], 'texto parcial do vocabulário permanece visível');
    assert.deepEqual(unknown, [226, 232, 240], 'texto externo desconhecido recebe máscara');
    assert.deepEqual(sensitive, [226, 232, 240], 'padrão sensível vence o vocabulário');
    assert.deepEqual(data, [226, 232, 240], 'linha de dados recebe skeleton cinza');
    const [menu] = pixels(second, [[88, 165]]);
    assert.notDeepEqual(menu, [255, 255, 255], 'item aparece no menu aberto');
    assert.equal(writes, 0, 'item final não pode executar ação');
  } finally {
    server.closeAllConnections(); await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
