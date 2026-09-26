import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProductMap } from '../lib/product-map.mjs';

const fixture = new URL('./fixtures/product-map/', import.meta.url).pathname;
const actions = { open: { route: '/configuracoes/channel', target: 'channel-connect' } };
const guides = [{ guide: { guideId: 'reconnect', steps: [{ actionId: 'open' }] } }];
const root = await mkdtemp(join(tmpdir(), 'product-map-rework-'));
try {
  await cp(fixture, root, { recursive: true });
  const frontRoot = join(root, 'front');
  const backRoot = join(root, 'back');
  const frontFile = join(frontRoot, 'src/Channel.tsx');
  const backFile = join(backRoot, 'ChannelController.cs');
  const scan = (baseline) => buildProductMap({ frontRoot, backRoot, guides, actions, baseline });
  const front = await readFile(frontFile, 'utf8');
  const back = await readFile(backFile, 'utf8');
  const clean = await scan();
  assert.deepEqual(clean.pending, []);

  await writeFile(frontFile, '// data-tour-id="channel-connect"\nexport const Channel = () => <button data-tour-id="channel-gone">Conectar</button>;');
  const commented = await scan(clean.manifest);
  assert.ok(!commented.manifest.markers.some(({ id }) => id === 'channel-connect'));
  assert.match(commented.pending.join('\n'), /reconnect: marcador ausente channel-connect/u);
  await writeFile(frontFile, 'export const Channel = () => <button data-tour-id={target}>Conectar</button>;');
  const dynamic = await scan();
  assert.ok(!dynamic.manifest.markers.some(({ id }) => id === 'channel-connect'));
  assert.match(dynamic.pending.join('\n'), /marcador dinâmico/u);
  await writeFile(frontFile, front);

  await writeFile(backFile, '[Route("api/[controller]")]\n[Authorize(Policy = "Channels.Read")]\npublic class ChannelController {\n  [HttpGet("read")] public void Read() {}\n  [HttpPost("export")][Authorize(Policy = "Channels.Export")] public void Export() {}\n}');
  const protectedMap = await scan();
  assert.ok(protectedMap.manifest.permissions.some(({ method, policy }) => method === 'Export' && policy === 'Channels.Export'));
  const protectedCode = await readFile(backFile, 'utf8');
  await writeFile(backFile, protectedCode.replace('[Authorize(Policy = "Channels.Export")]', ''));
  const lost = await scan(protectedMap.manifest);
  assert.ok(lost.changes.some((item) => item.includes('Export') && item.includes('Channels.Export')));
  assert.match(lost.pending.join('\n'), /reconnect: autorização perdida .*Export/u);
  await writeFile(backFile, '// [Authorize(Policy = "Channels.Fake")]\n/* [Authorize(Policy = "Channels.Hidden")] */\nconst string s = "[Authorize(Policy = \\"Channels.String\\")]";\n' + protectedCode);
  const lexed = await scan();
  assert.ok(!lexed.manifest.permissions.some((item) => /Fake|Hidden|String/u.test(JSON.stringify(item))));
  await writeFile(backFile, back);

  const script = resolve(import.meta.dirname, '../scripts/product-map.mjs');
  const guideFile = join(root, 'guides.json');
  const output = join(root, 'report.json');
  const actionsFile = join(root, 'actions.json');
  await writeFile(guideFile, JSON.stringify(guides));
  await writeFile(actionsFile, JSON.stringify(actions));
  execFileSync('git', ['init', '-q', frontRoot]);
  execFileSync('git', ['init', '-q', backRoot]);
  for (const dir of [frontRoot, backRoot]) execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  const run = () => spawnSync(process.execPath, [script, frontRoot, backRoot, '-', '-', output, '--guides-file', guideFile, '--actions-file', actionsFile], { encoding: 'utf8' });
  assert.equal(run().status, 0, 'coherent guide and marker must pass');
  await writeFile(frontFile, front.replace('channel-connect', 'channel-gone'));
  assert.notEqual(run().status, 0, 'missing published marker must fail the script');
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Product map rework test OK');
