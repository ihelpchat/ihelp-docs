import { auditPages } from '../mcp/security-review.mjs';

const root = new URL('../', import.meta.url).pathname;
const { findings, counts } = await auditPages(root);
for (const { path, blocks, warnings } of findings) {
  console.log(`${path}:`);
  for (const item of blocks) console.log(`  BLOQUEIO: ${item}`);
  for (const item of warnings) console.log(`  AVISO: ${item}`);
}
console.log(`Páginas auditadas: API ${counts.api}; não-API ${counts.nonApi}`);
console.log(`Páginas com achados: API ${findings.filter(({ path }) => path.startsWith('api/')).length}; não-API ${findings.filter(({ path }) => !path.startsWith('api/')).length}`);
