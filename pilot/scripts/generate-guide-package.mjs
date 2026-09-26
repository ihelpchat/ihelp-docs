import { checkGuidePackage, writeGuidePackage } from '../lib/guide-package.mjs';

const root = new URL('../', import.meta.url).pathname;
const check = process.argv.includes('--check');
const result = check ? await checkGuidePackage(root) : await writeGuidePackage(root);
console.log(`Pacote de guias: ${result.manifest.guides.length} guias; SHA ${result.manifest.contentSha256}`);
