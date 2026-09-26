import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { calculateGuideImpact } from '../lib/guide-impact.mjs';
import actions from '../architecture/product-actions.json' with { type: 'json' };

const [beforeFile, afterFile, outputFile] = process.argv.slice(2);
if (!beforeFile || !afterFile || !outputFile) throw new Error('Uso: guide-impact.mjs BEFORE AFTER OUTPUT');
const root = resolve(import.meta.dirname, '..');
async function snapshot(file, name) {
  try { return { value: JSON.parse(await readFile(file, 'utf8')) }; }
  catch (error) {
    if (error.code === 'ENOENT') return { value: null, pending: `${name} ausente` };
    if (error instanceof SyntaxError) return { value: null, pending: `${name}: JSON inválido` };
    throw error;
  }
}
const [before, after, guidePackage] = await Promise.all([
  snapshot(beforeFile, 'snapshot anterior'), snapshot(afterFile, 'snapshot atual'), compileGuidePackage(root),
]);
const result = calculateGuideImpact({ before: before.value, after: after.value, guides: guidePackage.catalog.guides, actions,
  sources: guidePackage.sources });
if (before.pending || after.pending) result.pending = [before.pending, after.pending].filter(Boolean);
await writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(`${result.proposals.length} propostas; ${result.pending.length} pendências`);
if (before.pending || after.pending) process.exitCode = 2;
else if (result.pending.length) process.exitCode = 1;
