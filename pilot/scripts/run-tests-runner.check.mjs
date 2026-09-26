import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const runner = resolve(import.meta.dirname, '../mcp/run-tests.mjs');
const mcpDir = resolve(import.meta.dirname, '../mcp');
const expected = [
  'test.mjs',
  'update-roundtrip.test.mjs',
  ...[
    'assistant-quality', 'campaign-hotfix', 'conversation-v1-correction',
    'conversation-v1-duplicates', 'conversation-v1-r2', 'conversation-v1-target',
    'conversation-v1', 'conversational-guides', 'conversational-rework',
    'conversational-trust', 'crm-optional-branch', 'editorial-ai',
    'package-delete-only', 'package-github', 'product-context', 'real-state',
    'sensitive-data', 'top-support-intents', 'transport-limits',
  ].map((name) => `${name}.test.mjs`),
];

const run = (directory, ...args) => spawnSync(process.execPath, [runner, directory, ...args], { encoding: 'utf8' });
const actual = readdirSync(mcpDir).filter((name) => name === 'test.mjs' || name.endsWith('.test.mjs'));
for (const name of expected) assert.ok(actual.includes(name), `missing baseline test: ${name}`);
const discovered = [
  ...['test.mjs', 'update-roundtrip.test.mjs'].filter((name) => actual.includes(name)),
  ...actual.filter((name) => name !== 'test.mjs' && name !== 'update-roundtrip.test.mjs').sort(),
];
const listed = run(mcpDir, '--list');
assert.equal(listed.status, 0, listed.stderr);
assert.deepEqual(listed.stdout.trim().split('\n'), [
  `MCP tests (${discovered.length}):`,
  ...discovered.map((name) => `mcp/${name}`),
]);

const temporary = mkdtempSync(join(tmpdir(), 'mcp-runner-'));
try {
  assert.notEqual(run(temporary).status, 0, 'zero tests must fail');

  writeFileSync(join(temporary, 'test.mjs'), 'process.exit(1);\n');
  writeFileSync(join(temporary, 'zz-next.test.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(join(temporary, 'ran-next'))}, 'yes');\n`);
  assert.equal(run(temporary).status, 1, 'test failure must return status 1');
  assert.equal(existsSync(join(temporary, 'ran-next')), false, 'runner must stop at first failure');

  writeFileSync(join(temporary, 'test.mjs'), 'throw new Error("intentional exception");\n');
  assert.notEqual(run(temporary).status, 0, 'uncaught exception must fail');

  writeFileSync(join(temporary, 'test.mjs'), 'process.exit(0);\n');
  const success = run(temporary);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /test\.mjs/);
  console.log(`Runner check OK: ${expected.length} current files; empty, exit 1, and exception verified`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
