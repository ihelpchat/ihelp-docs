import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';

const workflow = readFileSync(process.argv[2] ?? resolve(import.meta.dirname, '../../.github/workflows/deploy.yml'), 'utf8');
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

const document = parseDocument(workflow);
assert.equal(document.errors.length, 0, 'workflow YAML must be valid');
const parsed = document.toJS();
for (const job of Object.values(parsed.jobs ?? {})) {
  const steps = job.steps ?? [];
  const artifact = steps.find((step) => step.uses?.startsWith('actions/upload-pages-artifact@'));
  if (!artifact) continue;
  const artifactPath = artifact.with?.path;
  assert.equal(typeof artifactPath, 'string', 'published artifact path must be explicit');
  const build = steps.find((step) => step.name === 'Build website' && /\bnpm run build\b/.test(step.run ?? ''));
  assert.ok(build, 'published artifact must have a Build website step');
  assert.equal(artifactPath, `${build['working-directory']}/out`, 'artifact must come from the published build');
  for (const [key, value] of Object.entries({ ...parsed.env, ...job.env, ...build.env })) {
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    assert.doesNotMatch(String(value), /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?/i,
      `${key} in published Build website points to a local address`);
  }
}

console.log('Workflow concurrency check OK');
