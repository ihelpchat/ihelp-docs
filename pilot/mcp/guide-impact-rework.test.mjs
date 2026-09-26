import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { buildGuideReferenceIndex, calculateGuideImpact } from '../lib/guide-impact.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };
import snapshot from '../product-map/approved.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..');
const compiled = await compileGuidePackage(root);
const guides = compiled.catalog.guides;
assert.equal(guides.length, 3, 'usar os três guias publicados da base');
const index = buildGuideReferenceIndex(guides, actions, compiled.sources, snapshot.manifest);
const recado = index.find(({ guideId }) => guideId === 'recado-fora-do-horario');
assert.ok(recado.references.some(({ kind, key }) => kind === 'label' && key === 'Salvar Alterações'), 'fonte do MDX associa rótulo ao guia');
assert.ok(recado.references.some(({ kind }) => kind === 'permission'), 'rota da ação associa endpoint ao guia');

const labelAfter = structuredClone(snapshot);
labelAfter.frontSha = 'c'.repeat(40);
labelAfter.manifest.labels = labelAfter.manifest.labels.map((item) => item.label === 'Salvar Alterações'
  ? { ...item, label: 'Salvar modificações' } : item);
const labelImpact = calculateGuideImpact({ before: snapshot, after: labelAfter, guides, actions, sources: compiled.sources });
assert.deepEqual([...new Set(labelImpact.proposals.filter((item) => item.dependency === 'label').map((item) => item.guideId))],
  ['recado-fora-do-horario'], 'rótulo alterado deve impactar só o guia de recado');

const permission = snapshot.manifest.permissions.find((item) => recado.references.some((ref) => ref.kind === 'permission' &&
  ref.key === `${item.controller}.${item.method}:${item.verb}:${item.route}`));
assert.ok(permission);
const permissionAfter = structuredClone(snapshot);
permissionAfter.backSha = 'd'.repeat(40);
permissionAfter.manifest.permissions = permissionAfter.manifest.permissions.filter((item) => item !== permission);
const permissionImpact = calculateGuideImpact({ before: snapshot, after: permissionAfter, guides, actions, sources: compiled.sources });
assert.ok(permissionImpact.proposals.some((item) => item.guideId === recado.guideId && item.dependency === 'permission' && item.kind === 'avisar'));

const dir = await mkdtemp(join(tmpdir(), 'guide-impact-'));
try {
  const afterFile = join(dir, 'after.json');
  const outputFile = join(dir, 'report.json');
  await writeFile(afterFile, JSON.stringify(snapshot));
  const invoke = (beforeFile) => spawnSync(process.execPath, ['scripts/guide-impact.mjs', beforeFile, afterFile, outputFile], { cwd: root, encoding: 'utf8' });
  assert.equal(invoke(join(dir, 'missing.json')).status, 2, 'snapshot ausente tem exit code próprio');
  assert.ok((JSON.parse(await readFile(outputFile, 'utf8'))).pending.includes('snapshot anterior ausente'));
  const invalid = join(dir, 'invalid.json');
  await writeFile(invalid, '{');
  assert.equal(invoke(invalid).status, 2, 'JSON inválido tem exit code próprio');
  assert.ok((JSON.parse(await readFile(outputFile, 'utf8'))).pending.includes('snapshot anterior: JSON inválido'));
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('Guide impact rework test OK');
