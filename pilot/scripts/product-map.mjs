import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { buildProductMap } from '../lib/product-map.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };

const [front, back, output] = process.argv.slice(2).filter((item) => item !== '--approve');
if (!front || !back || !output) throw new Error('Uso: product-map.mjs FRONT BACK OUTPUT [--approved FILE] [--approve]');
const root = resolve(import.meta.dirname, '..');
const option = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const approvedFile = resolve(option('--approved') ?? resolve(root, 'product-map/approved.json'));
const approving = process.argv.includes('--approve');
const guideFile = process.argv.includes('--guides-file') ? process.argv[process.argv.indexOf('--guides-file') + 1] : null;
const actionFile = process.argv.includes('--actions-file') ? process.argv[process.argv.indexOf('--actions-file') + 1] : null;
const actionCatalog = actionFile ? JSON.parse(await readFile(actionFile, 'utf8')) : actions;
const guides = guideFile ? JSON.parse(await readFile(guideFile, 'utf8')) : (await compileGuidePackage(root)).catalog.guides;
const approved = await readFile(approvedFile, 'utf8').then(JSON.parse).catch((error) => {
  if (approving && error.code === 'ENOENT') return null;
  throw error;
});
if (approved && (!approved.frontSha || !approved.backSha || !approved.manifest ||
    !['routes', 'markers', 'labels', 'permissions'].every((key) => Array.isArray(approved.manifest[key])))) {
  throw new Error(`Manifest aprovado inválido: ${approvedFile}`);
}
const current = await buildProductMap({ frontRoot: front, backRoot: back, guides, actions: actionCatalog, baseline: approved?.manifest });
const sha = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = { frontSha: sha(front), backSha: sha(back), ...current };
if (approving) {
  await mkdir(dirname(approvedFile), { recursive: true });
  await writeFile(approvedFile, `${JSON.stringify({ frontSha: report.frontSha, backSha: report.backSha, manifest: report.manifest })}\n`);
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`front ${report.frontSha}; back ${report.backSha}`);
console.log(`rotas ${report.manifest.routes.length}; rótulos ${report.manifest.labels.length}; marcadores ${report.manifest.markers.length}; permissões ${report.manifest.permissions.length}`);
for (const change of report.changes) console.log(`mudança: ${change}`);
for (const item of report.informational) console.log(`informação: ${item}`);
for (const pending of report.pending) console.log(`pendência: ${pending}`);
if (report.pending.length > 0 && !approving && !process.argv.includes('--allow-pending')) process.exitCode = 1;
