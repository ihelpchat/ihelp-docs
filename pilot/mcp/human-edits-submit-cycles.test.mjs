import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderArticle, submitContentPackage } from './content-service.mjs';
import { readArticle } from './editorial-standard.mjs';
import { MCP_GIT_AUTHOR } from './human-edits.mjs';

const repo = await mkdtemp(join(tmpdir(), 'm560-submit-cycles-'));
const root = join(repo, 'pilot');
const path = 'docs/teste/contatos';
const file = `pilot/content/docs/${path}.mdx`;
const git = (...args) => execFileSync('git', ['--no-pager', ...args], { cwd: repo, encoding: 'utf8' }).trim();
const oldFetch = globalThis.fetch;
const oldToken = process.env.GITHUB_TOKEN;
const oldRepository = process.env.GITHUB_REPOSITORY;
const writes = [];
const pulls = [];
const body = 'Abra Contatos no menu lateral. Confira a lista antes de continuar. Selecione a opção de importar. Revise o arquivo escolhido e confirme as colunas. Corrija as linhas inválidas antes de concluir. Aguarde o resultado aparecer na tela. Pesquise um contato recém cadastrado para confirmar o sucesso. Se o contato não aparecer, revise o número e repita apenas a linha corrigida. Este procedimento mantém os demais contatos já cadastrados na conta.';
try {
  await mkdir(join(root, 'content/docs/docs/teste'), { recursive: true });
  git('init', '-q');
  git('config', 'user.name', MCP_GIT_AUTHOR.name);
  git('config', 'user.email', MCP_GIT_AUTHOR.email);
  git('commit', '--allow-empty', '-qm', 'seed');
  const original = renderArticle({ path, title: 'Importar contatos', description: 'Passo a passo público para importar contatos no iHelp.',
    source: 'produto', contentType: 'tutorial', mcpGeneratedSha: git('rev-parse', 'HEAD'),
    body: `## Produto\n\n${body}\n\n## Humana\n\nOrientação original.\n` });
  await writeFile(join(repo, file), original);
  git('add', file);
  git('commit', '-qm', 'MCP generation');
  await writeFile(join(repo, file), original.replace('Orientação original.', 'Orientação humana preservada.'));
  git('-c', 'user.email=editor@example.test', 'commit', '-qam', 'human edit');
  process.env.GITHUB_TOKEN = 'fixture-token';
  process.env.GITHUB_REPOSITORY = 'ihelpchat/ihelp-docs';
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (pathname.includes('/git/ref/heads/')) return { ok: true, json: async () => ({ object: { sha: git('rev-parse', 'HEAD') } }) };
    if (pathname.endsWith('/git/refs') && method === 'POST') return { ok: true, json: async () => ({}) };
    if (pathname.endsWith('/pulls') && method === 'POST') {
      pulls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ html_url: 'https://github.com/ihelpchat/ihelp-docs/pull/123' }) };
    }
    const target = decodeURIComponent(pathname.split('/contents/')[1] ?? '');
    if (target && method === 'GET') return target === file
      ? { ok: true, json: async () => ({ sha: 'fixture-file-sha', content: Buffer.from(await readFile(join(repo, file))).toString('base64') }) }
      : { ok: false, status: 404 };
    if (target && method === 'PUT') {
      writes.push({ target, payload: JSON.parse(init.body) });
      return { ok: true, json: async () => ({}) };
    }
    throw Error(`Unexpected GitHub request: ${method} ${pathname}`);
  };
  for (const cycle of [1, 2]) {
    const article = await readArticle(root, path);
    const proposal = { ...article, body: article.body.replace('Confira a lista antes de continuar.', `Confira a lista antes de continuar. Orientação do produto ${cycle}.`) };
    const before = writes.length;
    await submitContentPackage(root, [proposal], 'pull_request', 'service:fixture', [], { base: 'integration/claricia-v2' });
    const updates = writes.slice(before).filter(({ target }) => target === file);
    assert.equal(updates.length, 1, 'outra seção gera atualização da página');
    assert.deepEqual(updates[0].payload.author, MCP_GIT_AUTHOR);
    const content = Buffer.from(updates[0].payload.content, 'base64').toString('utf8');
    assert.equal(content.slice(content.indexOf('## Humana')), original.slice(original.indexOf('## Humana')).replace('Orientação original.', 'Orientação humana preservada.'));
    assert.match(pulls.at(-1).body, /Seções preservadas byte a byte/);
    await writeFile(join(repo, file), content);
    git('commit', '-qam', `MCP update ${cycle}`);
  }
  const current = await readFile(join(repo, file), 'utf8');
  const article = await readArticle(root, path);
  const before = writes.length;
  await submitContentPackage(root, [{ ...article, body: article.body.replace('Orientação humana preservada.', 'Orientação futura do produto.') }],
    'pull_request', 'service:fixture', [], { base: 'integration/claricia-v2' });
  const finalWrites = writes.slice(before);
  assert.equal(finalWrites.filter(({ target }) => target === file).length, 0, 'submissão não sobrescreve seção humana após dois commits do MCP');
  const notices = finalWrites.filter(({ target }) => target.startsWith('pilot/mcp/notices/'));
  assert.equal(notices.length, 1, 'conflito produz aviso na PR');
  const notice = Buffer.from(notices[0].payload.content, 'base64').toString('utf8');
  for (const text of [notice, pulls.at(-1).body]) {
    assert.match(text, /Orientação humana preservada/);
    assert.match(text, /Orientação futura do produto/);
  }
  assert.equal(await readFile(join(repo, file), 'utf8'), current);
  console.log('human edits submit cycles: ok (Git real, submissão real, GitHub simulado; conflito gera só aviso)');
} finally {
  globalThis.fetch = oldFetch;
  if (oldToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = oldToken;
  if (oldRepository === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = oldRepository;
  await rm(repo, { recursive: true, force: true });
  console.log('CLEANUP: OK (fixture Git própria)');
}
