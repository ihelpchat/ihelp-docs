import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { calculateGuideImpact } from '../lib/guide-impact.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };

const [beforeFile, afterFile, outputFile] = process.argv.slice(2);
if (!beforeFile || !afterFile || !outputFile) throw new Error('Uso: guide-impact.mjs BEFORE AFTER OUTPUT');
const root = resolve(import.meta.dirname, '..');
const [before, after, guidePackage] = await Promise.all([
  readFile(beforeFile, 'utf8').then(JSON.parse),
  readFile(afterFile, 'utf8').then(JSON.parse),
  compileGuidePackage(root),
]);
const result = calculateGuideImpact({ before, after, guides: guidePackage.catalog.guides, actions });
await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(`${result.proposals.length} propostas; ${result.pending.length} pendências`);
if (result.pending.length) process.exitCode = 1;
