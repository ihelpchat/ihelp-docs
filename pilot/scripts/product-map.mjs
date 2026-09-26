import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { buildProductMap } from '../lib/product-map.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };

const [front, back, previousFront, previousBack, output] = process.argv.slice(2);
if (!front || !back || !output) throw new Error('Uso: product-map.mjs FRONT BACK [PREVIOUS_FRONT PREVIOUS_BACK] OUTPUT');
const root = resolve(import.meta.dirname, '..');
const guideFile = process.argv.includes('--guides-file') ? process.argv[process.argv.indexOf('--guides-file') + 1] : null;
const actionFile = process.argv.includes('--actions-file') ? process.argv[process.argv.indexOf('--actions-file') + 1] : null;
const actionCatalog = actionFile ? JSON.parse(await readFile(actionFile, 'utf8')) : actions;
const guides = guideFile ? JSON.parse(await readFile(guideFile, 'utf8')) : (await compileGuidePackage(root)).catalog.guides;
const current = await buildProductMap({ frontRoot: front, backRoot: back, guides, actions: actionCatalog });
if (previousFront && previousBack && previousFront !== '-') {
  const previous = await buildProductMap({ frontRoot: previousFront, backRoot: previousBack, guides: [], actions: actionCatalog });
  const compared = await buildProductMap({ frontRoot: front, backRoot: back, guides, actions: actionCatalog, baseline: previous.manifest });
  current.changes = compared.changes;
  current.pending = compared.pending;
}
const sha = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = { frontSha: sha(front), backSha: sha(back), ...current };
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`front ${report.frontSha}; back ${report.backSha}`);
console.log(`rotas ${report.manifest.routes.length}; rótulos ${report.manifest.labels.length}; marcadores ${report.manifest.markers.length}; permissões ${report.manifest.permissions.length}`);
for (const change of report.changes) console.log(`mudança: ${change}`);
for (const pending of report.pending) console.log(`pendência: ${pending}`);
if (report.pending.length > 0) process.exitCode = 1;
