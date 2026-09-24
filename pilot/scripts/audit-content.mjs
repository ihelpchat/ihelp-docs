import { auditContent } from '../mcp/editorial-standard.mjs';

const root = new URL('../', import.meta.url).pathname;
const result = await auditContent(root);
console.log(`Auditoria editorial: ${result.valid}/${result.total} artigos válidos.`);
for (const article of result.articles) console.log(`- ${article.path}: ${article.issues.join('; ')}`);
if (result.invalid) process.exitCode = 1;
