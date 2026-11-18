// Refresh only front facts at an immutable commit; backend permissions/provenance are preserved.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProductMap } from '../lib/product-map.mjs';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import runtime from '../product-map/runtime.front.json' with { type: 'json' };
import actions from '../architecture/product-actions.json' with { type: 'json' };
const [front, revision, output] = process.argv.slice(2);
if (!front || !revision || !output) throw new Error('Usage: refresh-product-map-front.mjs FRONT COMMIT OUTPUT');
const frontSha = execFileSync('git', ['-C', front, 'rev-parse', `${revision}^{commit}`], { encoding: 'utf8' }).trim();
const approved = JSON.parse(await readFile(output, 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'guide-front-map-'));
try {
  const frontRoot = join(temporary, 'front'), backRoot = join(temporary, 'empty-back');
  await mkdir(frontRoot); await mkdir(backRoot);
  const archive = execFileSync('git', ['-C', front, 'archive', frontSha, 'src', 'tsconfig.json'], { maxBuffer: 150 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', frontRoot], { input: archive });
  const guides = (await compileGuidePackage(new URL('..', import.meta.url).pathname)).catalog.guides;
  const result = await buildProductMap({ frontRoot, backRoot, guides, actions, runtime });
  const snapshot = { ...approved, frontSha, runtimeSourceSha: runtime.sourceSha, sourceRevisions: { ...approved.sourceRevisions,
    front: [...new Set([...(approved.sourceRevisions?.front ?? []), approved.frontSha, frontSha])].sort() },
    manifest: { ...result.manifest, permissions: approved.manifest.permissions } };
  await writeFile(output, JSON.stringify(snapshot) + '\n');
  console.log(JSON.stringify({ frontSha, backSha: approved.backSha, routes: snapshot.manifest.routes.length,
    elements: snapshot.manifest.elements.length, backendPermissionsPreserved: true }));
} finally { await rm(temporary, { recursive: true, force: true }); }
