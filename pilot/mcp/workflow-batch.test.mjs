import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { parseDocument } from 'yaml';

const files = ['deploy.yml', 'product-map.yml'];
const workflows = Object.fromEntries(files.map((file) => {
  const doc = parseDocument(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8'));
  assert.deepEqual(doc.errors, [], `${file}: valid YAML`);
  return [file, doc.toJS()];
}));

function context(event, branch, labels = [], target = 'staging', enabled = 'true', runner = '') {
  return {
    github: {
      event_name: event, ref: `refs/heads/${branch}`,
      event: { action: 'synchronize', pull_request: { base: { ref: 'integration/claricia-v2' }, labels: labels.map((name) => ({ name })) } },
    },
    inputs: { target }, vars: { CLARICIA_DEPLOY_ENABLED: enabled, CI_LOTE_RUNS_ON: runner },
    steps: { token: { outputs: { ready: 'true' } }, deployment: { outputs: { ready: 'true' } } },
    runner: { os: 'Linux' },
  };
}

// Evaluate the expressions from the parsed workflows, never a second copy of their policy.
function evaluate(value, ctx) {
  if (value == null) return true;
  if (typeof value !== 'string') return value;
  const expression = value.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replaceAll('github.event.pull_request.labels.*.name', 'github.event.pull_request.labels.map(label => label.name)');
  return runInNewContext(expression, {
    ...ctx, contains: (values, item) => values.includes(item),
    startsWith: (value, prefix) => value.startsWith(prefix), fromJSON: JSON.parse,
    always: () => true, success: () => true, failure: () => false, cancelled: () => false,
  }, { timeout: 100 });
}

function matches(branch, pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`).test(branch);
}

function triggered(workflow, ctx) {
  const event = workflow.on[ctx.github.event_name];
  if (event === undefined) return false;
  if (!event) return true;
  const branch = ctx.github.event_name === 'pull_request' ? ctx.github.event.pull_request.base.ref : ctx.github.ref.slice(11);
  if (event.branches && !event.branches.some((pattern) => matches(branch, pattern))) return false;
  if (ctx.github.event_name === 'pull_request') {
    return (event.types ?? ['opened', 'synchronize', 'reopened']).includes(ctx.github.event.action);
  }
  return true;
}

function selected(definitions, ctx) {
  const jobs = [];
  function visit(file, local, prefix = '') {
    const workflow = definitions[file];
    const visited = new Map();
    function jobRuns(name) {
      if (visited.has(name)) return visited.get(name);
      const job = workflow.jobs[name];
      assert.ok(job, `${file}: dependency ${name} exists`);
      const needs = typeof job.needs === 'string' ? [job.needs] : job.needs ?? [];
      const runs = needs.every(jobRuns) && Boolean(evaluate(job.if, local));
      visited.set(name, runs);
      if (!runs) return false;
      if (job.uses) {
        const called = job.uses.replace('./.github/workflows/', '');
        assert.ok(definitions[called]?.on.workflow_call !== undefined, `${called}: callable`);
        const defaults = Object.fromEntries(Object.entries(definitions[called].on.workflow_call?.inputs ?? {}).map(([key, input]) => [key, input.default]));
        visit(called, { ...local, inputs: { ...defaults, ...job.with } }, `${prefix}${name}/`);
      } else {
        jobs.push({ name: `${prefix}${name}`, job, ctx: local, steps: (job.steps ?? []).filter((step) => evaluate(step.if, local)) });
      }
      return true;
    }
    Object.keys(workflow.jobs).forEach(jobRuns);
  }
  if (triggered(definitions['deploy.yml'], ctx)) visit('deploy.yml', ctx);
  return jobs;
}

const gates = [
  ['content', /npm run content:validate/], ['MCP', /npm run mcp:test/],
  ['types', /npm run types:check/], ['lint', /npm run lint/],
  ['metadata', /node scripts\/release.mjs prepare/], ['build', /npm run build/],
  ['artifact', /node scripts\/release.mjs artifact out/], ['UI', /npm run qa:ui/],
  ['guide', /npm run qa:guide(?:\s|$)/], ['guide-proof', /npm run qa:guide-proof/],
  ['assistant', /npm run qa:assistant/], ['legibility', /node scripts\/visual\/assistant-legibility.test.mjs/],
  ['product-map', /node docs\/pilot\/scripts\/product-map.mjs .*--approved docs\/pilot\/product-map\/approved.json/],
];

function assertSuite(definitions, ctx) {
  const jobs = selected(definitions, ctx);
  assert.ok(jobs.length, 'validation run selected');
  const steps = jobs.flatMap(({ job, steps }) => {
    assert.notEqual(job['continue-on-error'], true, 'job failures must block the run');
    return steps;
  });
  for (const [label, command] of gates) {
    const matches = steps.filter((step) => command.test(step.run ?? ''));
    assert.ok(matches.length, `gate selected: ${label}`);
    for (const step of matches) {
      assert.notEqual(step['continue-on-error'], true, `gate blocks: ${label}`);
      assert.ok(step['working-directory'], `gate directory: ${label}`);
    }
  }
  assert.equal(steps.filter((step) => /npm run mcp:test|node mcp\/run-tests.mjs/.test(step.run ?? '')).length, 1, 'MCP suite runs once');
  assert.ok(!jobs.some(({ job }) => job.environment || job.permissions?.pages === 'write' || job.permissions?.['id-token'] === 'write'), 'validation cannot access deploy environments or permissions');
  return jobs;
}

const publications = ['release-build', 'deploy', 'deploy-service', 'deploy-docs-staging', 'deploy-production-vercel'];
function assertNoDeploy(definitions, ctx) {
  for (const name of publications) {
    assert.equal(Boolean(evaluate(definitions['deploy.yml'].jobs[name].if, ctx)), false, `${name}: deployment forbidden`);
  }
  const jobs = selected(definitions, ctx);
  for (const { name, steps } of jobs) {
    assert.ok(!publications.includes(name), `${name}: deployment forbidden`);
    assert.ok(!steps.some((step) => /railway up|vercel@.*deploy/.test(step.run ?? '') || /actions\/(deploy-pages|upload-pages-artifact)@/.test(step.uses ?? '')), `${name}: no publishing steps`);
  }
}

test('batch push selects every existing gate in one run and cannot publish', () => {
  for (const enabled of ['true', 'false']) {
    const ctx = context('push', 'lote/integration__claricia-v2/2610', [], 'staging', enabled);
    assertSuite(workflows, ctx);
    assertNoDeploy(workflows, ctx);
  }
});

test('normal PRs skip the suite; ci label selects the same gates, including labeled event', () => {
  for (const action of ['opened', 'reopened', 'synchronize', 'labeled', 'unlabeled']) {
    const ctx = context('pull_request', 'feature', []);
    ctx.github.event.action = action;
    assert.equal(selected(workflows, ctx).length, 0, `unlabeled PR ${action}`);
    assertNoDeploy(workflows, ctx);
    if (action !== 'unlabeled') {
      ctx.github.event.pull_request.labels.push({ name: 'ci' });
      assertSuite(workflows, ctx);
      assertNoDeploy(workflows, ctx);
    }
  }
  assert.equal(selected(workflows, context('push', 'feature')).length, 0, 'ordinary branch push');
  assert.equal(triggered(workflows['product-map.yml'], context('pull_request', 'feature', ['ci'])), false, 'no second PR suite');
  assert.equal(triggered(workflows['product-map.yml'], context('push', 'lote/test/2610')), false, 'one push workflow for lote.sh');
});

test('main and manual publication conditions remain unchanged', () => {
  const cases = [
    ['push', 'main', 'staging', ['release-build', 'deploy-service', 'deploy-docs-staging']],
    ['workflow_dispatch', 'main', 'staging', ['release-build', 'deploy-service', 'deploy-docs-staging']],
    ['workflow_dispatch', 'main', 'production', ['release-build', 'deploy', 'deploy-service', 'deploy-production-vercel']],
    ['workflow_dispatch', 'integration/claricia-v2', 'production', ['release-build', 'deploy', 'deploy-service', 'deploy-production-vercel']],
  ];
  for (const [event, branch, target, expected] of cases) {
    for (const enabled of ['true', 'false']) {
      const ctx = context(event, branch, [], target, enabled);
      assert.ok(triggered(workflows['deploy.yml'], ctx));
      const active = publications.filter((name) => evaluate(workflows['deploy.yml'].jobs[name].if, ctx));
      assert.deepEqual(active, enabled === 'true' ? expected : [], `${event}/${branch}/${target}/${enabled}`);
      assert.ok(selected(workflows, ctx).some(({ name }) => name === 'build'));
    }
  }
});

test('runner contract accepts hosted string and local label array; Chrome supports macOS', () => {
  for (const [runner, expected] of [['', 'ubuntu-latest'], ['"ubuntu-latest"', 'ubuntu-latest'], ['["self-hosted","ihelp-local"]', ['self-hosted', 'ihelp-local']]]) {
    const ctx = context('push', 'lote/test/2610', [], 'staging', 'true', runner);
    for (const { job, ctx: local } of assertSuite(workflows, ctx)) {
      assert.deepEqual(JSON.parse(JSON.stringify(evaluate(job['runs-on'], local))), expected);
    }
  }
  const job = workflows['deploy.yml'].jobs.build;
  for (const [os, chrome] of [['Linux', '/usr/bin/google-chrome'], ['macOS', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']]) {
    const ctx = context('push', 'lote/test/2610');
    ctx.runner.os = os;
    for (const step of job.steps.filter((step) => /qa:ui|qa:guide|qa:assistant/.test(step.run ?? ''))) {
      assert.equal(evaluate(step.env?.CHROME_PATH ?? job.env?.CHROME_PATH, ctx), chrome);
      assert.doesNotMatch(step.run, /CHROME_PATH=\/usr\/bin/, 'inline path cannot override runner Chrome');
    }
  }
});

test('mutation probes detect no batch checks, batch deployment and every omitted or bypassed gate', () => {
  const ctx = context('push', 'lote/test/2610');
  const noBatch = structuredClone(workflows);
  noBatch['deploy.yml'].on.push.branches = ['main'];
  assert.throws(() => assertSuite(noBatch, ctx), /validation run selected/);
  for (const name of publications) {
    const unsafe = structuredClone(workflows);
    unsafe['deploy.yml'].jobs[name].if = "github.event_name != 'pull_request'";
    assert.throws(() => assertNoDeploy(unsafe, ctx), /deployment forbidden/, name);
  }
  for (const [label, command] of gates) {
    for (const mode of ['omit', 'skip', 'ignore failure']) {
      const changed = structuredClone(workflows);
      let count = 0;
      for (const workflow of Object.values(changed)) for (const job of Object.values(workflow.jobs)) {
        job.steps = job.steps?.filter((step) => {
          if (!command.test(step.run ?? '')) return true;
          count++;
          if (mode === 'skip') step.if = false;
          if (mode === 'ignore failure') step['continue-on-error'] = true;
          return mode !== 'omit';
        });
      }
      assert.ok(count, `mutation changed gate: ${label}`);
      assert.throws(() => assertSuite(changed, ctx), /gate selected|gate blocks/, `${mode}: ${label}`);
    }
  }
});
