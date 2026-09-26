import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/deploy.yml'), 'utf8');
const concurrency = workflow.match(/^concurrency:\s*\n((?:^[ \t]+.*\n)*)/m)?.[1];
assert.ok(concurrency, 'workflow concurrency block is required');

const setting = (name) => concurrency.match(new RegExp(`^  ${name}: (.+)$`, 'm'))?.[1];
assert.equal(
  setting('group'),
  "${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || 'pages' }}",
  'each pull request must use its own pr-<number> group; other events must use pages',
);
assert.equal(
  setting('cancel-in-progress'),
  "${{ github.event_name == 'pull_request' }}",
  'only pull request runs may cancel an in-progress run',
);

console.log('Workflow concurrency check OK');
