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
  "${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('deploy-{0}-{1}', github.ref, github.event_name == 'workflow_dispatch' && inputs.target || 'staging') }}",
  'deploy concurrency must be scoped by ref and environment',
);
assert.equal(
  setting('cancel-in-progress'),
  "${{ github.event_name == 'pull_request' }}",
  'only pull request runs may cancel an in-progress run',
);

const document = parseDocument(workflow);
assert.equal(document.errors.length, 0, 'workflow YAML must be valid');
const parsed = document.toJS();
assert.deepEqual(parsed.permissions, { contents: 'read' }, 'workflow-wide token must be read-only');
assert.ok(!parsed.jobs.build.environment, 'PR verification cannot access an environment');
assert.ok(!parsed.jobs.build.permissions?.pages && !parsed.jobs.build.permissions?.['id-token'], 'PR job cannot write Pages or mint OIDC tokens');
assert.match(parsed.jobs['release-build'].if, /github\.event_name != 'pull_request'/);
assert.equal(parsed.jobs['release-build'].environment, "${{ github.event_name == 'workflow_dispatch' && inputs.target || 'staging' }}");
assert.equal(parsed.jobs.deploy.permissions?.pages, 'write');
assert.equal(parsed.jobs.deploy.permissions?.['id-token'], 'write');
const serviceSmoke = parsed.jobs['deploy-service'].steps.find((step) => step.name === 'Deploy and wait for service verdict');
assert.equal(serviceSmoke?.env?.NEXT_PUBLIC_ASSISTANT_URL, '${{ vars.NEXT_PUBLIC_ASSISTANT_URL }}');
assert.equal(serviceSmoke?.env?.CLARICIA_DOCS_ORIGIN, '${{ vars.CLARICIA_DOCS_ORIGIN }}');
assert.equal(serviceSmoke?.env?.CLARICIA_DOCS_URL, '${{ vars.CLARICIA_DOCS_URL }}');
assert.match(serviceSmoke?.run ?? '', /service out "\$NEXT_PUBLIC_ASSISTANT_URL"/);
assert.doesNotMatch(workflow, /CLARICIA_HEALTH_URL/);
for (const [name, job] of Object.entries(parsed.jobs ?? {})) {
  if (name !== 'deploy') {
    assert.ok(!job.permissions?.pages && !job.permissions?.['id-token'], `${name} cannot write Pages or mint OIDC tokens`);
  }
  const steps = job.steps ?? [];
  for (const step of steps) {
    if (step.uses?.startsWith('actions/checkout@')) {
      assert.equal(step.with?.['persist-credentials'], false, `${name} checkout must not persist credentials`);
    }
    for (const [key, value] of Object.entries({ ...parsed.env, ...job.env, ...step.env })) {
      if (!key.startsWith('NEXT_PUBLIC_')) continue;
      assert.doesNotMatch(String(value), /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?/i,
        `${key} in ${name} points to a local address`);
    }
  }
  const artifact = steps.find((step) => step.uses?.startsWith('actions/upload-pages-artifact@'));
  if (!artifact) continue;
  const artifactPath = artifact.with?.path;
  assert.equal(typeof artifactPath, 'string', 'published artifact path must be explicit');
  const build = steps.find((step) => step.name === 'Build website' && /\bnpm run build\b/.test(step.run ?? ''));
  assert.ok(build, 'published artifact must have a Build website step');
  assert.equal(artifactPath, `${build['working-directory']}/out`, 'artifact must come from the published build');
  assert.equal(name, 'release-build', 'only environment build may publish an artifact');
  const expected = '${{ vars.NEXT_PUBLIC_ASSISTANT_URL }}';
  assert.equal(build.env?.NEXT_PUBLIC_ASSISTANT_URL, expected, 'published build must use selected environment URL');
  assert.equal(steps.find((step) => step.name === 'Prepare release metadata')?.env?.NEXT_PUBLIC_ASSISTANT_URL, expected);
  assert.equal(steps.find((step) => step.name === 'Smoke public artifact')?.env?.NEXT_PUBLIC_ASSISTANT_URL, expected);
  assert.match(steps.find((step) => step.name === 'Smoke public artifact')?.run ?? '', /artifact out "\$NEXT_PUBLIC_ASSISTANT_URL"/);
  for (const [key, value] of Object.entries({ ...parsed.env, ...job.env, ...build.env })) {
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    assert.doesNotMatch(String(value), /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(?::\d+)?/i,
      `${key} in published Build website points to a local address`);
  }
}
assert.ok(!parsed.jobs.build.steps.some((step) => 'NEXT_PUBLIC_ASSISTANT_URL' in (step.env ?? {})), 'PR build must not use any environment URL');

console.log('Workflow concurrency check OK');
