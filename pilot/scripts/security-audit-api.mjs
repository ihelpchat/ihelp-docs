import { auditApiPages } from '../mcp/security-review.mjs';

const root = new URL('../', import.meta.url).pathname;
const findings = await auditApiPages(root);
for (const { path, blocks, warnings } of findings) {
  console.log(`${path}:`);
  for (const item of blocks) console.log(`  BLOQUEIO: ${item}`);
  for (const item of warnings) console.log(`  AVISO: ${item}`);
}
console.log(`Páginas com achados: ${findings.length}`);
