import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pages = ['agenda-de-contatos.mdx', 'robo-de-atendimento.mdx'];
const article = (name) => readFileSync(join(root, 'content/docs/docs/sobre-o-sistema', name), 'utf8');
const approved = JSON.parse(readFileSync(join(root, 'product-map/approved.json'), 'utf8')).manifest;
const labels = new Set(approved.labels.map(({ label }) => label));

test('os guias publicados de Robôs mantêm prints de cada tarefa e arquivos públicos existentes', () => {
  const body = article('robo-de-atendimento.mdx');
  const sections = [...body.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  const byTitle = new Map(sections.map(([, title, content]) => [title, content]));
  for (const title of ['Criar um robô', 'Encontrar um robô', 'Montar um menu de opções',
    'Encaminhar uma escolha para a equipe', 'Editar um robô', 'Salvar e publicar o fluxo']) {
    assert.match(byTitle.get(title) ?? '', /!\[[^\]]+\]\(\/img\/help\/[^)]+\)/u, `sem print: ${title}`);
  }
  const images = [...body.matchAll(/!\[([^\]]+)\]\((\/img\/help\/[^)]+)\)/gu)];
  assert.ok(images.length >= 7, 'faltam prints nos guias de tarefa');
  for (const [, alt, url] of images) {
    assert.ok(alt && !/ficha|teste/iu.test(alt), `alt inadequado: ${alt}`);
    assert.ok(existsSync(join(root, 'public', url)), `imagem ausente: ${url}`);
  }
});

test('rótulos em negrito dos passos de Contatos e Robôs pertencem aos fatos do front', () => {
  // Termos de navegação/estado e controles não exportados pelo mapa atual são revisados aqui.
  const exceptions = new Set(['Contatos', 'Robôs', 'Meus', 'Iniciar Fluxo', '+', 'Adicionar robô',
    'Telefone', 'Enviar arquivo', 'Selecionar cabeçalho', 'Mapear colunas', 'Verificar dados',
    'Contato criado com sucesso!', 'Campo atualizado com sucesso!', 'Tag adicionada com sucesso!',
    'Tag criada e adicionada com sucesso!', 'Proprietário atualizado com sucesso!',
    'Importação concluída']);
  const check = (page, body) => {
    const steps = body.split('\n').filter((line) => /^\d+\. /u.test(line));
    assert.ok(steps.length > 0, `sem passos: ${page}`);
    for (const line of steps) {
      for (const [, label] of line.matchAll(/\*\*([^*]+)\*\*/gu)) {
        assert.ok(labels.has(label) || exceptions.has(label), `${page}: rótulo ausente no front: ${label}`);
      }
    }
  };
  for (const page of pages) check(page, article(page));
  assert.throws(() => check('robo-de-atendimento.mdx',
    article('robo-de-atendimento.mdx').replace('**Buscar robô**', '**Buscar canal**')),
  /rótulo ausente no front: Buscar canal/u);
});
