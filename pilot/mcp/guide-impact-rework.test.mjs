import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { parseGuideSources } from '../lib/canonical-guides.mjs';
import { parseArticle } from '../mcp/editorial-standard.mjs';
import { buildGuideReferenceIndex, calculateGuideImpact } from '../lib/guide-impact.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };
import snapshot from '../product-map/approved.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..');
const compiled = await compileGuidePackage(root);
const libFiles = (await readdir(join(root, 'lib'))).filter((file) => file.endsWith('.mjs'));
const parsers = await Promise.all(libFiles.map(async (file) => ({ file, text: await readFile(join(root, 'lib', file), 'utf8') })));
assert.deepEqual(parsers.filter(({ text }) => text.includes('fonte: ([')).map(({ file }) => file),
  ['canonical-guides.mjs'], 'uma única regex de fonte em pilot/lib');
const parsedFixture = parseArticle('---\ndescription: "{/* fonte: fake | front@aaaaaaaaaaaa:src/Fake.tsx:1 | alvo: Falso */}"\n---\n{/* fonte: real | front@aaaaaaaaaaaa:src/Real.tsx:2 | alvo: Real */}', 'fixture');
assert.deepEqual(parseGuideSources(parsedFixture.body).map(({ stepId }) => stepId),
  ['real'], 'parser recebe só o corpo validado');
const guides = compiled.catalog.guides;
assert.equal(guides.length, 3, 'usar os três guias publicados da base');
const index = buildGuideReferenceIndex(guides, actions, compiled.sources, snapshot.manifest);
const recado = index.find(({ guideId }) => guideId === 'recado-fora-do-horario');
assert.ok(recado.references.some(({ kind, key }) => kind === 'label' && key.endsWith(':Salvar Alterações')), 'fonte do MDX associa rótulo ao guia');
assert.ok(!recado.references.some(({ kind }) => kind === 'permission'), 'rota de front sem prova não associa endpoint');

const labelAfter = structuredClone(snapshot);
labelAfter.frontSha = 'c'.repeat(40);
labelAfter.manifest.labels = labelAfter.manifest.labels.map((item) => item.label === 'Salvar Alterações' &&
  item.file === 'src/components/pages/Configuration/pages/DepartmentById/components/DepartmentConfigExtras/index.tsx'
  ? { ...item, label: 'Salvar modificações' } : item);
const labelImpact = calculateGuideImpact({ before: snapshot, after: labelAfter, guides, actions, sources: compiled.sources });
assert.equal(JSON.stringify(labelImpact), JSON.stringify(calculateGuideImpact({ before: snapshot, after: labelAfter, guides, actions, sources: compiled.sources })), 'replay do par real é idêntico');
assert.deepEqual([...new Set(labelImpact.proposals.filter((item) => item.dependency === 'label').map((item) => item.guideId))],
  ['recado-fora-do-horario'], 'rótulo alterado deve impactar só o guia de recado');

const permissionAfter = structuredClone(snapshot);
permissionAfter.backSha = 'd'.repeat(40);
permissionAfter.manifest.permissions = permissionAfter.manifest.permissions.map((item) =>
  item.controller === 'UserFavoritesController' && item.method === 'AddPipelineFavorite' ? { ...item, policy: 'changed' } : item);
const permissionImpact = calculateGuideImpact({ before: snapshot, after: permissionAfter, guides, actions, sources: compiled.sources });
assert.ok(!permissionImpact.proposals.some((item) => item.guideId === 'usuario-acesso' && item.dependency === 'permission'));
assert.ok(permissionImpact.info.some((item) => item.includes('usuario-acesso: permissão não mapeada')));
assert.ok(permissionImpact.pending.some((item) => item.includes('recado-fora-do-horario') && item.includes('escrever-recado') &&
  item.includes('DepartmentConfigExtras/index.tsx:353') && item.includes('rótulo da fonte não encontrado no manifest')));

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
