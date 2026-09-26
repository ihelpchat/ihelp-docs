import golden from '../mcp/grounding-golden.json' with { type: 'json' };
import { searchLocalProductContext } from '../mcp/local-product-context.mjs';

const missing = [];
for (const { topic, module, frontend, backend, backendExcluded } of golden.cases) {
  const { code } = await searchLocalProductContext(topic, module);
  for (const [role, expected] of [['frontend', frontend], ['backend', backend]]) {
    if (!expected) {
      if (role === 'backend' && backendExcluded) console.log(`${topic} | backend | excluído: ${backendExcluded}`);
      else missing.push(`${topic} | ${role} | esperado sem motivo`);
      continue;
    }
    const source = code.find((item) => item.role === role);
    const position = source?.matches.findIndex(({ path }) => path === expected) ?? -1;
    console.log(`${topic} | ${role} | ${source?.available ? (position >= 0 ? position + 1 : 'ausente/filtrado') : source?.reason} | ${expected}`);
    if (!source?.available || position < 0 || position >= 3) missing.push(`${topic} | ${role} | ${expected}`);
  }
}
if (missing.length) {
  console.error(`Arquivos causais fora do top 3:\n${missing.join('\n')}`);
  process.exitCode = 1;
}
