import golden from '../mcp/grounding-golden.json' with { type: 'json' };
import { searchLocalProductContext } from '../mcp/local-product-context.mjs';

for (const { topic, module, frontend, backend } of golden.cases) {
  const { code } = await searchLocalProductContext(topic, module);
  for (const [role, expected] of [['frontend', frontend], ['backend', backend]]) {
    const source = code.find((item) => item.role === role);
    const position = source?.matches.findIndex(({ path }) => path === expected) ?? -1;
    console.log(`${topic} | ${role} | ${source?.available ? (position >= 0 ? position + 1 : 'ausente/filtrado') : source?.reason} | ${expected}`);
  }
}
