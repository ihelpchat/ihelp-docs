import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { productSparseFolders, searchLocalProductContext } from './local-product-context.mjs';
import { syncProductCheckouts } from './product-checkouts.mjs';
import { addUploadedScreenshot } from '../scripts/screen-capture/capture.mjs';
import { approvePage, imagesUsedByArticles } from './screen-capture-service.mjs';
import { attachScreenshotsToArticle, screenshotForStep } from './screen-capture-manifest.mjs';
import { validateRailwayDockerContext } from './railway-docker-context.mjs';

const appSha = 'a'.repeat(40);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = (suffix) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(suffix)]);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } }).trim();

test('sparse real mantém todo arquivo fixo e entrega fatos de tela após sync', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm563-sparse-'));
  const before = process.env.PRODUCT_LOCAL_CHECKOUT;
  try {
    const files = {
      'src/components/core/components/Router/utils/pagesData.tsx': "import Contacts from '../../../../pages/Contacts'; export const pages = [{ path: '/contact', element: <Contacts /> }];",
      'src/components/pages/Contacts/index.tsx': "export default function Contacts() { return <button title={t('contact.add')}>Adicionar</button>; }",
      'src/translate/pt.ts': "export default { contact: { add: 'Adicionar Contato' } };",
    };
    const repositories = {};
    for (const [id, role, ref] of [['front', 'frontend', 'master'], ['back', 'backend', 'release/validation']]) {
      const bare = join(root, `${id}.git`); const work = join(root, `${id}-source`);
      await mkdir(work); git(root, 'init', '--bare', bare); git(work, 'init'); git(work, 'checkout', '-b', ref);
      for (const [path, content] of Object.entries(id === 'front' ? files : { 'Controllers/TestController.cs': 'public class TestController {}' })) {
        await mkdir(join(work, dirname(path)), { recursive: true }); await writeFile(join(work, path), content);
      }
      git(work, 'add', '.'); git(work, 'commit', '-m', 'synthetic'); git(work, 'remote', 'add', 'origin', bare); git(work, 'push', 'origin', ref);
      repositories[id] = { url: bare, role, ref };
    }
    const stateDir = join(root, 'state');
    await syncProductCheckouts({ stateDir, token: 'synthetic-token', repositories });
    const checkout = join(stateDir, 'checkouts/current/front');
    process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
    assert.ok(productSparseFolders('frontend').includes('src/translate'), 'pasta da tradução precisa estar no sparse');
    assert.match(await readFile(join(checkout, 'src/translate/pt.ts'), 'utf8'), /Adicionar Contato/u);
    const context = await searchLocalProductContext('Agenda de Contatos', 'Contatos', { repositoryIds: ['frontend'], cache: false });
    assert.equal(context.code[0].available, true, context.code[0].reason);
    assert.ok(context.code[0].screenFacts.length > 0, JSON.stringify(context.code[0].screenPending));
  } finally {
    if (before === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT; else process.env.PRODUCT_LOCAL_CHECKOUT = before;
    await rm(root, { recursive: true, force: true });
  }
});

test('cada origem mantém bytes próprios; upload pendente e recaptura não trocam bytes do artigo', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm563-images-'));
  const page = 'contatos'; const step = '01-abrir';
  const A = png('automatic-A'); const B = png('approved-B'); const C = png('pending-C');
  const env = { SCREEN_CAPTURE_ADMIN_TOKEN: 'synthetic-admin-token-1234567890' };
  try {
    await mkdir(join(root, page), { recursive: true });
    await writeFile(join(root, page, `${step}.png`), A);
    let manifest = { version: 1, entries: [{ page, step, label: 'Abrir', route: '/', owner: 'fixture',
      line: 0, listIndex: 0, file: `/img/mcp/${page}/${step}.png`, sha256: digest(A),
      alt: 'Tela automática', source: 'automatic', checkoutSha: appSha, bundleSha: appSha }] };
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
    await addUploadedScreenshot({ manifest, page, step, bytes: B, alt: 'Tela aprovada', root });
    manifest = await approvePage({ page, step, token: env.SCREEN_CAPTURE_ADMIN_TOKEN, approvedBy: 'user:fixture' }, { root, env });
    assert.equal(screenshotForStep(manifest, page, step)?.source, 'upload');
    assert.equal((await readFile(join(root, page, `${step}.png`))).equals(A), true, 'aprovação não sobrescreve automático');
    await addUploadedScreenshot({ manifest, page, step, bytes: C, alt: 'Tela pendente', root });
    assert.equal(screenshotForStep(manifest, page, step)?.source, 'automatic');
    const article = attachScreenshotsToArticle({ path: 'docs/contatos', body: '1. Abrir' }, manifest, appSha);
    const used = await imagesUsedByArticles([article], { root });
    assert.equal(Buffer.from(used[0].base64, 'base64').equals(A), true, 'PR leva bytes da entrada selecionada');
    assert.equal(screenshotForStep(manifest, page, step)?.sha256, digest(A));
    await writeFile(join(root, page, `${step}.png`), B);
    await assert.rejects(imagesUsedByArticles([article], { root }), /hash|integridade/iu, 'leitura confere hash do manifesto');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('railway up inclui COPY e transfere menos de 20 MiB sem assets do site', async () => {
  const root = new URL('../', import.meta.url).pathname;
  const docker = await readFile(join(root, 'Dockerfile.mcp'), 'utf8');
  const ignore = await readFile(join(root, '.railwayignore'), 'utf8');
  assert.deepEqual(validateRailwayDockerContext(docker, ignore), []);
  const patterns = ignore.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const included = (path) => !patterns.some((pattern) => path === pattern || path.startsWith(`${pattern.replace(/\/$/u, '')}/`));
  for (const folder of ['public/videos', 'public/img', 'public/brand']) assert.equal(included(`${folder}/fixture.png`), false, folder);
  const tracked = git(root, 'ls-files', '-z').split('\0').filter(Boolean);
  let bytes = 0;
  for (const file of tracked.filter(included)) bytes += (await stat(join(root, file))).size;
  assert.ok(bytes < 20 * 1024 * 1024, `Railway upload ${bytes} bytes`);
  const mutated = ignore.split('\n').filter((line) => line.trim() !== 'public/videos').join('\n');
  const mutPatterns = mutated.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  let mutatedBytes = 0;
  for (const file of tracked.filter((path) => !mutPatterns.some((pattern) => path === pattern || path.startsWith(`${pattern}/`))))
    mutatedBytes += (await stat(join(root, file))).size;
  assert.ok(mutatedBytes >= 20 * 1024 * 1024, 'sem ignore de vídeos o limite deve falhar');
});
