import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildProductMap } from '../lib/product-map.mjs';
import { elementsForRoutes, resolveLocator } from '../lib/product-map-query.mjs';
const root = await mkdtemp(join(tmpdir(), 'map-v2-'));
try {
  const frontRoot = join(root, 'front'), backRoot = join(root, 'back');
  await mkdir(backRoot);
  for (const [path, source] of Object.entries({
    'pagesData.tsx': `import Screen from './Screen'; export const pagesData = [{path:'/one', title:'One', element:<Screen/>}, {path:'/two',title:'Two',element:<Screen/>}];`,
    'Screen.tsx': `import EditModal from './EditModal'; import Controls from './Controls'; import { Visible as ViaBarrel } from './barrel'; export default function Screen(){return <><Button>Salvar</Button><Button>Salvar</Button><Input label="Nome"/><a href="/">Ajuda?</a><Tab label="Geral"/><MenuItem>Editar</MenuItem><Title>Conta</Title><EditModal/><ViaBarrel/><Button>{busy ? 'Aguarde...' : 'Continuar'}</Button><ButtonsContainer><Button>Dentro</Button></ButtonsContainer><InputContainer><Input label="Campo real"/></InputContainer><SelectNode label="Nó de teste"/><InputLabel>Rótulo</InputLabel><Dialog><Controls/></Dialog></>}`,
    'EditModal.tsx': `export default function EditModal(){return <Dialog><Button tooltipTitle="Fechar"/><ButtonIconAction/><Textarea placeholder="Descrição"/><Button>Salvar</Button></Dialog>}`,
    'barrel.ts': `export { default as Other } from './Other'; export { default as Visible } from './Visible';`,
    'Other.tsx': `export default function Other(){return <Button>Intruso</Button>}`,
    'Visible.tsx': `export default function Visible(){return <Button>Único</Button>}`,
    'Controls.tsx': `export default function Controls(){return <Button>Contexto</Button>}`,
    'Shared.tsx': `export const Shared = () => <Button aria-label="Compartilhado"/>;`,
    'unrelated.tsx': `export const configData = {path:'/fake',title:'Fake',element:<Button>Fantasma</Button>};`,
    'features/configurations/registry/prefix.ts': "export const CONFIG_V4_PREFIX = '/configuracoes';",
    'features/configurations/registry/sections.ts': "import {CONFIG_V4_PREFIX} from './prefix'; export const CONFIG_SECTIONS = [{id:'canais',label:'Canais',path:`${CONFIG_V4_PREFIX}/canais`,legacyPaths:['/configuracoes/channel']}];",
    'features/configurations/registry/elements.tsx': "const Canais = lazy(() => import('../pages/Canais')); const sections = {canais:<Canais/>};",
    'features/configurations/pages/Canais.tsx': 'export default function Canais(){return <Button>Novo canal</Button>}',
  })) {
    const file = join(frontRoot, 'src', path);
    await mkdir(dirname(file), {recursive:true});
    await writeFile(file, source);
  }
  const { manifest } = await buildProductMap({ frontRoot, backRoot, guides: [], actions: {} });
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(elementsForRoutes(manifest, ['/one']).length, 17);
  const query = (name, kind = 'button', within) => resolveLocator(manifest, '/one', { kind, name, within });
  assert.equal(query('Salvar').reason, 'ambiguous');
  const save = elementsForRoutes(manifest, ['/one']).filter(e => e.name === 'Salvar');
  assert.equal(save.length, 3, 'same-line occurrences cannot be deduplicated');
  assert.ok(save.every(e => e.duplicates === (e.inModal ? 1 : 2)));
  assert.equal(new Set(save.map(e => `${e.source}:${e.column}`)).size, 3);
  assert.equal(query('Salvar', 'button', 'dialog').ok, true);
  assert.equal(query('Nome', 'field').ok, true);
  assert.equal(query('Fechar', 'button', 'dialog').element.inModal, true);
  assert.equal(query('Nome', 'field', 'dialog').reason, 'missing');
  assert.equal(query('Fechar', 'button', 'anything').reason, 'missing');
  for (const name of ['Compartilhado', 'Intruso', 'Fantasma', '', 'Ausente']) assert.equal(query(name).reason, 'missing');
  for (const name of ['Único', 'Aguarde...', 'Continuar']) assert.equal(query(name).ok, true);
  assert.equal(query('Ajuda?', 'link').ok, true);
  assert.equal(query('Geral', 'tab').ok, true);
  assert.equal(query('Editar', 'menuitem').ok, true);
  assert.equal(query('Dentro').ok, true, 'layout containers must not become duplicate buttons');
  assert.equal(query('Campo real', 'field').ok, true);
  assert.equal(query('Contexto', 'button', 'dialog').element.inModal, true, 'dialog scope follows the JSX use, not only component names');
  assert.ok(!manifest.elements.some(e => ['ButtonsContainer', 'InputContainer', 'SelectNode', 'InputLabel'].includes(e.component)));
  assert.equal(resolveLocator(manifest, '/unknown', {kind:'button',name:'Fechar'}).reason, 'route');
  assert.equal(resolveLocator(manifest, '/fake', {kind:'button',name:'Fantasma'}).reason, 'route');
  for (const route of ['/configuracoes/canais','/configuracoes/channel']) assert.equal(resolveLocator(manifest, route, {kind:'button',name:'Novo canal'}).ok, true);
  assert.ok(manifest.elements.some((e) => e.name === null && e.component === 'ButtonIconAction' && e.inModal));
  assert.ok(manifest.elements.some((e) => e.route === null && e.shared));
  assert.match(query('Nome', 'field').element.source, /^src\/Screen.tsx:1$/u);
  assert.equal(resolveLocator({manifest}, '/two', {kind:'heading',name:'Conta'}).ok, true);
  assert.deepEqual((await buildProductMap({frontRoot,backRoot,guides:[],actions:{}})).manifest, manifest);
} finally { await rm(root, {recursive:true,force:true}); }
console.log('Product map v2/query OK');
