import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProductMap } from '../lib/product-map.mjs';

const fixture = new URL('./fixtures/product-map/', import.meta.url).pathname;
const root = await mkdtemp(join(tmpdir(), 'product-map-r2-'));
const actions = { open: { route: '/configuracoes/channel', target: 'channel-connect' } };
const guides = [{ guide: { guideId: 'reconnect', steps: [{ actionId: 'open' }] } }];
const script = resolve(import.meta.dirname, '../scripts/product-map.mjs');
try {
  const front = join(root, 'front');
  const back = join(root, 'back');
  const previousFront = join(root, 'previous-front');
  const previousBack = join(root, 'previous-back');
  await cp(join(fixture, 'front'), front, { recursive: true });
  await cp(join(fixture, 'back'), back, { recursive: true });
  await cp(front, previousFront, { recursive: true });
  await cp(back, previousBack, { recursive: true });
  const baseline = (await buildProductMap({ frontRoot: previousFront, backRoot: previousBack, guides: [], actions })).manifest;
  const routeFile = join(front, 'src/pagesData.tsx');
  const route = await readFile(routeFile, 'utf8');
  await writeFile(routeFile, `// path: '/configuracoes/channel', title: 'Canais'\n${route.replace('/configuracoes/channel', '/configuracoes/channels')}`);
  const moved = await buildProductMap({ frontRoot: front, backRoot: back, guides, actions, baseline });
  assert.ok(!moved.manifest.routes.some(({ path }) => path === '/configuracoes/channel'), 'commented route is not real');
  assert.match(moved.pending.join('\n'), /reconnect: rota ausente \/configuracoes\/channel/u);
  await writeFile(routeFile, route);

  const backend = join(back, 'ChannelController.cs');
  const original = await readFile(backend, 'utf8');
  await writeFile(backend, original.replace('[Authorize(Policy = "Channels.Read")]', ''));
  const lost = await buildProductMap({ frontRoot: front, backRoot: back, guides, actions, baseline });
  assert.match(lost.pending.join('\n'), /reconnect: autorização perdida .*Read/u);
  const guideFile = join(root, 'guides.json');
  const actionsFile = join(root, 'actions.json');
  const output = join(root, 'report.json');
  await writeFile(guideFile, JSON.stringify(guides));
  await writeFile(actionsFile, JSON.stringify(actions));
  for (const dir of [front, back]) {
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  }
  const approvedFile = join(root, 'approved.json');
  await writeFile(approvedFile, JSON.stringify({ frontSha: 'fixture-front', backSha: 'fixture-back', manifest: baseline }));
  const run = () => spawnSync(process.execPath, [script, front, back, output, '--approved', approvedFile, '--guides-file', guideFile, '--actions-file', actionsFile], { encoding: 'utf8' });
  assert.notEqual(run().status, 0, 'baseline authorization loss must fail CLI');
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.match(report.pending.join('\n'), /reconnect: autorização perdida .*Read/u);
  await writeFile(backend, original);

  const source = await readFile(resolve(import.meta.dirname, '../lib/product-map.mjs'), 'utf8');
  assert.doesNotMatch(source, /source\.matchAll\(/u, 'front source must be read through TypeScript parser');
  const workflow = await readFile(resolve(import.meta.dirname, '../../.github/workflows/product-map.yml'), 'utf8');
  assert.match(workflow, /node mcp\/run-tests\.mjs|npm run mcp:test/u, 'CI must discover all product-map tests');
  assert.doesNotMatch(workflow, /node mcp\/product-map(?:-rework|-r2)?\.test\.mjs/u, 'CI must not enumerate test files');
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Product map r2 test OK');
