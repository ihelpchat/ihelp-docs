import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadBusinessContext } from './faq-editorial.mjs';

const root = resolve(import.meta.dirname, '..');
const slug = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

test('repo público contém só modelo e README de contexto', async () => {
  assert.deepEqual((await readdir(join(root, 'architecture/business-context'))).sort(),
    ['README.md', '_modelo.md']);
});

test('sem BUSINESS_CONTEXT_DIR não lê contexto do repo', async () => {
  const old = process.env.BUSINESS_CONTEXT_DIR;
  const fixture = await mkdtemp(join(tmpdir(), 'faq-public-repo-'));
  delete process.env.BUSINESS_CONTEXT_DIR;
  try {
    await mkdir(join(fixture, 'architecture/business-context'), { recursive: true });
    await writeFile(join(fixture, 'architecture/business-context/contatos.md'),
      '🟢 PÚBLICO\nDeve ser ignorado.');
    assert.deepEqual(await loadBusinessContext(fixture, 'Contatos'), []);
  }
  finally { if (old === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = old;
    await rm(fixture, { recursive: true, force: true }); }
});

test('carrega geral e módulo da pasta privada com normalização única', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'faq-business-m566-'));
  const old = process.env.BUSINESS_CONTEXT_DIR;
  try {
    process.env.BUSINESS_CONTEXT_DIR = directory;
    await writeFile(join(directory, 'geral.md'), '🟢 PÚBLICO\nContexto geral.');
    const matrix = JSON.parse(await readFile(join(root, 'architecture/coverage-matrix.json'), 'utf8'));
    assert.equal(slug('Contatos'), 'contatos');
    assert.equal(slug('Robôs'), 'robos');
    for (const { module } of matrix) {
      await writeFile(join(directory, `${slug(module)}.md`), `🟢 PÚBLICO\nContexto de ${module}.`);
      assert.deepEqual((await loadBusinessContext(root, module)).map(({ path }) => path),
        [`business-context/${slug(module)}.md`, 'business-context/geral.md'].sort(), module);
    }
  } finally {
    if (old === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = old;
    await rm(directory, { recursive: true, force: true });
  }
});

test('aceita cabeçalho público formatado em Markdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'faq-business-markdown-'));
  try {
    await writeFile(join(directory, 'contatos.md'), '# Contatos\n\n> 🟢 **PÚBLICO** — contexto\n\nUso do módulo.');
    assert.deepEqual((await loadBusinessContext(root, 'Contatos', directory)).map(({ path }) => path),
      ['business-context/contatos.md']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('descarta arquivo interno e sem cabeçalho; mutação geral só sem módulo falha acima', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'faq-business-m566-'));
  const old = process.env.BUSINESS_CONTEXT_DIR;
  try {
    process.env.BUSINESS_CONTEXT_DIR = directory;
    await writeFile(join(directory, 'geral.md'), '🟢 PÚBLICO\nContexto geral.');
    await writeFile(join(directory, 'contatos.md'), '🟢 PÚBLICO\nContexto de contatos.');
    await writeFile(join(directory, 'robos.md'), '🟡 INTERNO\nNão publicar.');
    await writeFile(join(directory, 'tarefas.md'), 'Sem cabeçalho.');
    assert.deepEqual((await loadBusinessContext(root, 'Contatos')).map(({ path }) => path),
      ['business-context/contatos.md', 'business-context/geral.md']);
    assert.deepEqual((await loadBusinessContext(root, 'Robôs')).map(({ path }) => path),
      ['business-context/geral.md']);
    assert.deepEqual((await loadBusinessContext(root, 'Tarefas')).map(({ path }) => path),
      ['business-context/geral.md']);
  } finally {
    if (old === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = old;
    await rm(directory, { recursive: true, force: true });
  }
});

test('descarta contexto público com dado sensível e registra só arquivo e motivo', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'faq-business-sensitive-'));
  try {
    await writeFile(join(directory, 'geral.md'), '🟢 PÚBLICO\nContexto geral.');
    const cases = [
      { label: 'host interno', reason: 'host interno', unsafe: 'http://localhost/admin', safe: 'https://ajuda.ihelp.com.br/admin' },
      { label: 'e-mail', reason: 'dado pessoal', unsafe: 'pessoa@example.com', safe: 'pessoa exemplo' },
      { label: 'número longo', reason: 'dado pessoal', unsafe: '119876543210', safe: '123456789' },
      { label: 'token', reason: 'segredo', unsafe: 'sk-proj-abcdefghijklmnopqrstuv', safe: 'chave de exemplo' },
    ];
    for (const { label, reason, unsafe, safe } of cases) await t.test(label, async () => {
      const content = `🟢 PÚBLICO\nInformação de contatos: ${unsafe}.`;
      await writeFile(join(directory, 'contatos.md'), content);
      const logs = [];
      assert.deepEqual((await loadBusinessContext(root, 'Contatos', directory, { log: (message) => logs.push(message) }))
        .map(({ path }) => path), ['business-context/geral.md'], unsafe);
      assert.deepEqual(logs, [`Contexto ignorado: contatos.md (${reason})`], unsafe);
      assert.ok(logs.every((message) => !message.includes(unsafe) && !message.includes(content)), unsafe);

      await writeFile(join(directory, 'contatos.md'), content.replace(unsafe, safe));
      logs.length = 0;
      assert.deepEqual((await loadBusinessContext(root, 'Contatos', directory, { log: (message) => logs.push(message) }))
        .map(({ path }) => path), ['business-context/contatos.md', 'business-context/geral.md'], safe);
      assert.deepEqual(logs, [], safe);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sync privado converte cabeçalho, descarta inválidos e preserva geração anterior sem token', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'faq-business-state-'));
  const sourceDir = await mkdtemp(join(tmpdir(), 'faq-business-source-'));
  try {
    const { syncBusinessContext } = await import('./business-context-sync.mjs');
    assert.deepEqual(await syncBusinessContext({ stateDir }),
      { status: 'pending', reason: 'GITHUB_READ_TOKEN ausente' });
    await writeFile(join(sourceDir, 'geral.md'), '# Geral\n\n> 🟢 **PÚBLICO** — contexto\n\nDescrição geral.');
    await writeFile(join(sourceDir, 'contatos.md'), '# Contatos\n\n> 🟢 **PÚBLICO** — contexto\n\nDescrição de contatos.');
    await writeFile(join(sourceDir, 'interno.md'), '# Interno\n\n> 🟡 **INTERNO**\n\nPrivado.');
    const result = await syncBusinessContext({ stateDir, sourceDir });
    assert.equal(result.copied, 2);
    assert.deepEqual(result.skipped, ['interno.md']);
    assert.deepEqual((await loadBusinessContext(root, 'Contatos', result.directory)).map(({ path }) => path),
      ['business-context/contatos.md', 'business-context/geral.md']);
    assert.equal((await syncBusinessContext({ stateDir })).status, 'pending');
    assert.equal((await loadBusinessContext(root, 'Contatos', result.directory)).length, 2);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  }
});
