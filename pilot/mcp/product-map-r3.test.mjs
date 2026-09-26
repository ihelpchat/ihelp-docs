import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProductMap } from '../lib/product-map.mjs';

const fixture = new URL('./fixtures/product-map/', import.meta.url).pathname;
const root = await mkdtemp(join(tmpdir(), 'product-map-r3-'));
const actions = { open: { route: '/configuracoes/channel', target: 'channel-connect' } };
const guides = [{ guide: { guideId: 'reconnect', steps: [{ actionId: 'open' }] } }];
try {
  const front = join(root, 'front');
  const back = join(root, 'back');
  await cp(join(fixture, 'front'), front, { recursive: true });
  await cp(join(fixture, 'back'), back, { recursive: true });
  const backFile = join(back, 'ChannelController.cs');
  const approved = (await buildProductMap({ frontRoot: front, backRoot: back, guides, actions })).manifest;
  assert.deepEqual((await buildProductMap({ frontRoot: front, backRoot: back, guides, actions })).pending, [], 'unrelated dynamic marker must not block');
  assert.ok(approved.permissions.some(({ route }) => route === 'api/v:version/channel/read'), 'versioned endpoint must enter the manifest');

  const approvedFile = join(root, 'approved.json');
  const guideFile = join(root, 'guides.json');
  const actionsFile = join(root, 'actions.json');
  const reportFile = join(root, 'report.json');
  await writeFile(guideFile, JSON.stringify(guides));
  await writeFile(actionsFile, JSON.stringify(actions));
  for (const dir of [front, back]) {
    execFileSync('git', ['init', '-q', dir]);
    execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
  }
  const script = resolve(import.meta.dirname, '../scripts/product-map.mjs');
  const args = [script, front, back, reportFile, '--approved', approvedFile, '--guides-file', guideFile, '--actions-file', actionsFile];
  const run = () => spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(spawnSync(process.execPath, [...args, '--approve'], { encoding: 'utf8' }).status, 0, 'approve writes persistent baseline');
  assert.deepEqual((JSON.parse(await readFile(approvedFile, 'utf8'))).manifest, approved);
  assert.equal(run().status, 0, 'A: protected endpoint matches approved baseline');
  await writeFile(backFile, (await readFile(backFile, 'utf8')).replace('[Authorize(Policy = "Channels.Read")]', ''));
  assert.notEqual(run().status, 0, 'B: lost authorization must fail');
  await writeFile(join(front, 'src/unrelated.tsx'), 'export const unrelated = 1;');
  assert.notEqual(run().status, 0, 'C: unrelated change cannot clear persistent authorization loss');
  assert.match((JSON.parse(await readFile(reportFile, 'utf8'))).pending.join('\n'), /reconnect: autorização perdida/u);
  const workflow = await readFile(resolve(import.meta.dirname, '../../.github/workflows/product-map.yml'), 'utf8');
  assert.doesNotMatch(workflow, /archive HEAD\^|previous-front|previous-back/u, 'CI cannot use moving HEAD^ baseline');
  assert.match(workflow, /approved\.json/u, 'CI must read committed approved manifest');
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log('Product map r3 test OK');
