import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startQaSite } from '../scripts/visual/serve-qa-build.mjs';
import { assertAllowedTarget, runGuideProof } from '../scripts/guide-proof.mjs';

assert.throws(() => assertAllowedTarget('https://app.ihelpchat.com'), /recusad|permitid/u);
assert.throws(() => assertAllowedTarget('https://app.ihelpchat.com.evil.test'), /recusad|permitid/u);
assert.throws(() => assertAllowedTarget('http://staging.ihelpchat.com'), /recusad|permitid/u);
assert.throws(() => assertAllowedTarget('https://staging.ihelpchat.com@evil.test'), /recusad|permitid/u);
assert.doesNotThrow(() => assertAllowedTarget('http://127.0.0.1:4173'));
assert.doesNotThrow(() => assertAllowedTarget('https://staging.ihelpchat.com', { GUIDE_QA_ALLOWED_HOSTS: 'staging.ihelpchat.com' }));
assert.throws(() => assertAllowedTarget('https://app.ihelpchat.com', { GUIDE_QA_ALLOWED_HOSTS: 'app.ihelpchat.com' }), /recusad|permitid/u);

const root = await mkdtemp(join(tmpdir(), 'guide-proof-test-'));
const evidence = join(root, 'evidence');
const pages = [
  ['configuracoes/channel', 'guide-qr-open', 'Conectar'],
  ['configuracoes/user', 'guide-user-open', 'Novo usuário'],
  ['configuracoes/department', 'guide-department-open', 'Salvar Alterações'],
];
for (const [route, marker, label] of pages) {
  const dir = join(root, route);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), `<!doctype html><html><body>
    <main data-tour-id="${marker}"><button>${label}</button></main>
    <script>window.fixtureWrites = 0; if (new URLSearchParams(location.search).get('role') === 'denied') document.querySelector('button').disabled = true;
    document.querySelector('button').onclick = () => { window.fixtureWrites++ }</script>
  </body></html>`);
}
const site = await startQaSite(root, '');
try {
  const good = await runGuideProof({ baseUrl: site.url, evidenceDir: evidence, fixture: true });
  assert.equal(good.authorized, 'passed');
  assert.equal(good.denied, 'passed');
  assert.equal(good.qr, 'manual_required');
  assert.ok(good.steps.some((step) => step.status === 'passed'));
  const files = await readFile(join(evidence, 'report.json'), 'utf8');
  assert.doesNotMatch(files, /@|\+?[0-9]{10,}/u, 'relatório não contém contato');
  assert.ok(good.screenshots.every((name) => name.endsWith('.png')));

  const route = join(root, 'configuracoes/user/index.html');
  const original = await readFile(route, 'utf8');
  await writeFile(route, original.replace('data-tour-id="guide-user-open"', 'data-tour-id="removed"'));
  await assert.rejects(
    runGuideProof({ baseUrl: site.url, evidenceDir: join(root, 'broken'), fixture: true }),
    /guide-user-open/u,
    'remover marcador na cópia de teste deve reprovar',
  );
  await writeFile(route, original);
  await assert.rejects(
    runGuideProof({ baseUrl: 'https://app.ihelpchat.com', evidenceDir: join(root, 'production') }),
    /recusad|permitid/u,
    'produção deve ser recusada antes de abrir o navegador',
  );
} finally {
  await site.close();
  await rm(root, { recursive: true, force: true });
}
console.log('guide-proof: fixture, autorização, QR, host e marcador OK');
