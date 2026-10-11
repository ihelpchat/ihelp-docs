import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('fila inclui seção publicada nova e omite seção já revisada', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm579-fila-'));
  try {
    const content = join(root, 'content');
    const feedback = join(root, 'feedback');
    const output = join(root, 'privado', 'fila.json');
    await mkdir(join(content, 'docs'), { recursive: true });
    await mkdir(feedback);
    await writeFile(join(content, 'docs', 'exemplo.mdx'), '# Exemplo\n\n## Revisada\n\nTexto aprovado.\n\n## Nova\n\nTexto público novo.\n');
    await writeFile(join(feedback, 'revisao.json'), JSON.stringify({ pagina: 'exemplo', titulo: 'Revisada', decisao: 'aceitar' }));
    const { buildFeedbackQueue, writeFeedbackQueue } = await import('./fila-calibracao.mjs');
    const queue = await buildFeedbackQueue(content, feedback);
    assert.deepEqual(queue.map(({ pagina, titulo, texto }) => ({ pagina, titulo, texto })), [
      { pagina: 'docs/exemplo.mdx', titulo: 'Nova', texto: '## Nova\n\nTexto público novo.' },
    ]);
    assert.match(queue[0].id, /^[a-f0-9]{64}$/u);
    assert.deepEqual(await buildFeedbackQueue(content, feedback), queue);
    await writeFeedbackQueue(output, queue);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), queue);
    await assert.rejects(writeFeedbackQueue(new URL('arquivo-publico.json', import.meta.url).pathname, queue),
      /fora do repo/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fila recusa symlink para diretório do repo e symlink no arquivo de saída', async () => {
  const internal = await mkdtemp(join(import.meta.dirname, '.m579-fila-interna-'));
  const external = await mkdtemp(join(tmpdir(), 'm579-fila-externa-'));
  try {
    const alias = join(external, 'alias');
    await symlink(internal, alias);
    const { writeFeedbackQueue } = await import('./fila-calibracao.mjs');
    await assert.rejects(writeFeedbackQueue(join(alias, 'fila.json'), []), /fora do repo/u);
    assert.deepEqual(await readdir(internal), []);

    const target = join(external, 'alvo.json');
    const output = join(external, 'fila.json');
    await writeFile(target, 'intacto');
    await symlink(target, output);
    await assert.rejects(writeFeedbackQueue(output, []), /não aceita symlink/u);
    assert.equal(await readFile(target, 'utf8'), 'intacto');
  } finally {
    await rm(internal, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
