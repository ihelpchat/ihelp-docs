import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileGuidePackage, writeGuidePackage } from '../lib/guide-package.mjs';

const root = new URL('../', import.meta.url).pathname;
const check = process.argv.includes('--check');
const result = check ? await compileGuidePackage(root) : await writeGuidePackage(root);
if (check) {
  for (const [name, data] of Object.entries(result)) {
    const expected = JSON.stringify(data, (_, value) => value && !Array.isArray(value) && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value) + '\n';
    const actual = await readFile(join(root, 'public/guides', `${name}.json`), 'utf8');
    if (actual !== expected) throw new Error(`Pacote de guias desatualizado: ${name}.json`);
  }
}
console.log(`Pacote de guias: ${result.manifest.guides.length} guias; SHA ${result.manifest.contentSha256}`);
