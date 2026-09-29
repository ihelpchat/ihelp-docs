import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capturePlan, captureScreens } from './capture.mjs';
import { launch } from '../visual/measure.mjs';

const sha = 'a'.repeat(40);
const screenFacts = ['Mais opções', 'Importar Contatos'].map((text) => ({ kind: 'action', text,
  route: '/contact', owner: 'fixture', sha }));
const faqBody = '1. Clique em **Mais opções** e escolha **Importar Contatos**.';
const html = `<!doctype html><html><head><style>
body{margin:0;background:white;font:18px Arial} h1{position:absolute;left:80px;top:30px;margin:0}
svg{position:absolute;left:20px;top:36px} button{position:absolute;left:80px;top:100px;height:40px}
#menu{position:absolute;left:80px;top:145px;background:white} #menu button{position:static}
table{position:absolute;left:80px;top:220px} td{min-width:180px;height:30px}
</style></head><body><svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="rgb(18, 101, 180)"/></svg>
<h1>Contatos</h1><button onclick="document.getElementById('menu').hidden=false">Mais opções</button>
<div id="menu" hidden><button role="menuitem">Importar Contatos</button></div>
<table><thead><tr><th>Nome</th><th>Telefone</th></tr></thead><tbody><tr><td>Maria Teste</td><td>11988887777</td></tr></tbody></table>
</body></html>`;

async function pixels(png, points) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    return page.evaluate(async ({ source, points }) => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3));
    }, { source: `data:image/png;base64,${png.toString('base64')}`, points });
  } finally { await browser.close(); }
}

test('fixture preserva interface e ícone, mascara dados em cinza e abre menu', { timeout: 30000 }, async () => {
  const plan = capturePlan({ page: 'fixture', module: 'Contatos', faqBody,
    coverage: [{ module: 'Contatos', productRoutes: ['/contact'] }], screenFacts });
  assert.equal(plan[0].action, 'click', 'gatilho citado na mesma linha deve abrir o menu');
  const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'screen-r16-'));
  try {
    const result = await captureScreens({ baseUrl: `http://127.0.0.1:${server.address().port}`,
      plan, root, fixture: true, vocabulary: ['Contatos', 'Nome', 'Telefone', 'Mais opções', 'Importar Contatos'] });
    assert.deepEqual(result.steps.map((step) => step.status), ['capturado', 'capturado']);
    const first = await readFile(join(root, 'fixture', result.entries[0].file.split('/').at(-1)));
    const second = await readFile(join(root, 'fixture', result.entries[1].file.split('/').at(-1)));
    const [icon, title, data] = await pixels(first, [[32, 48], [85, 47], [85, 260]]);
    assert.deepEqual(icon, [18, 101, 180], 'ícone da interface permanece visível');
    assert.notDeepEqual(title, [226, 232, 240], 'título da interface permanece visível');
    assert.deepEqual(data, [226, 232, 240], 'linha de dados recebe skeleton cinza');
    const [menu] = await pixels(second, [[88, 165]]);
    assert.notDeepEqual(menu, [255, 255, 255], 'item aparece no menu aberto');
  } finally {
    server.closeAllConnections(); await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});
