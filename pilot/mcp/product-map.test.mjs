import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProductMap } from '../lib/product-map.mjs';

const fixture = new URL('./fixtures/product-map/', import.meta.url).pathname;
const actions = { open: { route: '/configuracoes/channel', label: 'Abrir Canais', target: 'channel-connect' } };
const guides = [{ guide: { guideId: 'reconnect', steps: [{ stepId: 'connect', actionId: 'open' }] } }];
const root = await mkdtemp(join(tmpdir(), 'product-map-'));
try {
  await cp(fixture, root, { recursive: true });
  let baseline;
  const scan = () => buildProductMap({ frontRoot: join(root, 'front'), backRoot: join(root, 'back'), guides, actions, baseline });
  const first = await scan();
  baseline = first.manifest;
  assert.deepEqual(first.pending, []);
  assert.ok(first.manifest.markers.some((item) => item.id === 'channel-connect'));
  assert.ok(first.manifest.routes.some((item) => item.path === '/configuracoes/channel'));
  assert.ok(first.manifest.permissions.some((item) => item.name === 'Channels.Read'));
  assert.deepEqual((await scan()).manifest, first.manifest, 'manifest must be deterministic');

  const frontFile = join(root, 'front/src/Channel.tsx');
  const original = await readFile(frontFile, 'utf8');
  await writeFile(frontFile, original.replace('data-tour-id="channel-connect"', 'data-tour-id="channel-renamed"'));
  const missing = await scan();
  assert.match(missing.pending.join('\n'), /reconnect.*channel-connect/u);
  await writeFile(frontFile, original);

  const routeFile = join(root, 'front/src/pagesData.tsx');
  const route = await readFile(routeFile, 'utf8');
  await writeFile(routeFile, route.replace('/configuracoes/channel', '/configuracoes/channels').replace('Canais', 'Conexões'));
  const changedRoute = await scan();
  assert.ok(changedRoute.changes.some((item) => item.includes('route') && item.includes('/configuracoes/channel')));
  assert.ok(changedRoute.changes.some((item) => item.includes('label') && item.includes('Conexões')));
  await writeFile(routeFile, route);

  const backFile = join(root, 'back/ChannelController.cs');
  const back = await readFile(backFile, 'utf8');
  await writeFile(backFile, back.replace('Channels.Read', 'Channels.Manage'));
  const changedPermission = await scan();
  assert.ok(changedPermission.changes.some((item) => item.includes('permission') && item.includes('Channels.Manage')));
  await writeFile(backFile, back);

  await writeFile(join(root, 'front/src/unrelated.tsx'), 'export const value = 1;');
  assert.deepEqual((await scan()).changes, []);
  assert.deepEqual((await scan()).pending, []);

  await writeFile(frontFile, original.replace('data-tour-id="channel-connect"', 'data-tour-id="person@example.com"'));
  assert.ok(!(await scan()).manifest.markers.some((item) => item.id.includes('@')));
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Product map test OK');
