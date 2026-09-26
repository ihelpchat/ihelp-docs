import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = process.argv[2] ?? dirname(fileURLToPath(import.meta.url));
const first = ['test.mjs', 'update-roundtrip.test.mjs'];
const names = readdirSync(directory)
  .filter((name) => name === 'test.mjs' || name.endsWith('.test.mjs'));
const tests = [
  ...first.filter((name) => names.includes(name)),
  ...names.filter((name) => !first.includes(name)).sort(),
];

if (tests.length === 0) {
  console.error(`No MCP tests found in ${directory}`);
  process.exit(1);
}

console.log(`MCP tests (${tests.length}):`);
for (const name of tests) console.log(`mcp/${name}`);

if (process.argv[3] !== '--list') {
  for (const name of tests) {
    const result = spawnSync(process.execPath, [join(directory, name)], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
