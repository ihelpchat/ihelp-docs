import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';

if (process.argv[2] === '--product-release') {
  const source = readFileSync(process.argv[3] ?? resolve(import.meta.dirname, '../../.github/workflows/product-release.yml'), 'utf8');
  const document = parseDocument(source);
  assert.equal(document.errors.length, 0, 'product-release YAML must be valid');
  const release = document.toJS();
  assert.deepEqual(Object.keys(release.on ?? {}).sort(), ['schedule', 'workflow_dispatch'], 'product-release triggers must be schedule and workflow_dispatch only');
  assert.deepEqual(release.permissions, { contents: 'read' }, 'product-release permissions must be contents: read');
  assert.equal(release.concurrency?.group, 'product-release', 'product-release must use its own concurrency group');
  assert.equal(release.concurrency?.['cancel-in-progress'], false, 'product-release cannot cancel an in-progress run');
  const steps = release.jobs?.detect?.steps ?? [];
  const checkouts = steps.filter((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkouts.length, 3, 'product-release needs docs and both product checkouts');
  for (const step of checkouts) assert.equal(step.with?.['persist-credentials'], false, 'product-release checkout cannot persist credentials');
  assert.deepEqual(checkouts.slice(1).map((step) => [step.with.repository, step.with.ref, step.with.token]), [
    ['ihelpchat/front-react', 'master', '${{ secrets.PRODUCT_READ_TOKEN }}'],
    ['ihelpchat/olah-ihelp', 'release/validation', '${{ secrets.PRODUCT_READ_TOKEN }}'],
  ], 'PRODUCT_READ_TOKEN must read the existing production refs');
  const availability = steps.find((step) => step.name === 'Check read-only token availability');
  assert.equal(availability?.env?.PRODUCT_READ_TOKEN, '${{ secrets.PRODUCT_READ_TOKEN }}', 'PRODUCT_READ_TOKEN availability must be checked');
  assert.match(availability?.run ?? '', /PRODUCT_READ_TOKEN não configurado/, 'missing read token must be summarized');
  const failedCheckout = steps.find((step) => step.name === 'Report checkout failure');
  assert.match(failedCheckout?.run ?? '', /checkout do produto falhou[\s\S]*exit 1/, 'checkout failure must be summarized and fail');
  const snapshot = steps.find((step) => step.name === 'Generate current snapshot');
  assert.match(snapshot?.run ?? '', /product-map\.mjs[^\n]*--allow-pending/, 'release snapshot must retain impact pendencies');
  assert.match(snapshot?.run ?? '', /snapshot do produto falhou[\s\S]*exit 1/, 'snapshot failure must be summarized and fail');
  const update = steps.find((step) => step.name === 'Update FAQ from release');
  assert.equal(update?.env?.GITHUB_TOKEN, '${{ secrets.DOCS_WRITE_TOKEN }}', 'DOCS_WRITE_TOKEN must be the update write token');
  assert.equal(update?.env?.DOCS_UPDATE_BASE, '${{ vars.DOCS_UPDATE_BASE }}', 'DOCS_UPDATE_BASE must come from repository variable');
  for (const step of steps) {
    if (step !== availability && !checkouts.includes(step)) assert.doesNotMatch(JSON.stringify(step), /PRODUCT_READ_TOKEN/, 'PRODUCT_READ_TOKEN only in availability and checkout');
    if (step !== update) assert.doesNotMatch(JSON.stringify(step), /DOCS_WRITE_TOKEN|DOCS_UPDATE_BASE/, 'DOCS_WRITE_TOKEN and DOCS_UPDATE_BASE only in update');
  }
  assert.equal((source.match(/secrets\.PRODUCT_READ_TOKEN/g) ?? []).length, 3, 'PRODUCT_READ_TOKEN only in availability and product checkouts');
  assert.equal((source.match(/secrets\.DOCS_WRITE_TOKEN/g) ?? []).length, 1, 'DOCS_WRITE_TOKEN only in update');
  console.log('Product release workflow check OK');
  process.exit(0);
}

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
