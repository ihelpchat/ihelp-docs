import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardModelOutput } from './model-output-guard.mjs';
import { searchLocalProductContext } from './local-product-context.mjs';

test('rótulo público coincidente com back não é eco; serviço privado e SQL continuam bloqueados', () => {
  const label = 'Nome do contato Telefone do contato E-mail do contato';
  const privateLine = 'if ( filters . Export ) return repository . Query ( filters )';
  const context = {
    callEvidence: [{ path: 'Comzada.Service/ServicesMySQL/ContactService.cs', excerpt: `${label}\n${privateLine}` }],
    screenFacts: [{ kind: 'column', text: label }],
    request: { description: label },
  };
  const publicResult = guardModelOutput({ articles: [{ body: label }] }, context, 'package');
  assert.equal(publicResult.value.articles[0].body, label);
  assert.equal(publicResult.internalCodeEcho, 0);
  const privateResult = guardModelOutput({ articles: [{ body: privateLine }] }, context, 'package');
  assert.equal(privateResult.value.status, 'needs_information');
  assert.equal(privateResult.internalCodeEcho, 1);
  const sql = guardModelOutput({ articles: [{ body: `SELECT ${label} FROM contacts` }] }, context, 'package');
  assert.equal(sql.value.status, 'needs_information');
});

test('rotas da matriz trazem Contatos e Robôs; título cobre módulo fora da matriz; ausente vira pendência', async () => {
  const checkout = await realpath(await mkdtemp(join(tmpdir(), 'm559-r6-front-')));
  const router = 'src/components/core/components/Router/utils/pagesData.tsx';
  const pages = {
    [router]: `import Contacts from '../../../../pages/Contacts';\nimport Robots from '../../../../pages/Robots';\nimport Inventory from '../../../../pages/Inventory';\nexport const pages = [\n  { path: '/contact', element: <Contacts /> },\n  { path: '/bot', element: <Robots /> },\n  { path: '/inventory', title: 'Estoque', element: <Inventory /> },\n];`,
    'src/components/pages/Contacts/index.tsx': 'export default function Contacts() { return <button onClick={add}>Adicionar Contato</button>; }',
    'src/components/pages/Robots/index.tsx': 'export default function Robots() { return <button onClick={add}>Adicionar Robô</button>; }',
    'src/components/pages/Inventory/index.tsx': 'export default function Inventory() { return <button onClick={add}>Adicionar Produto</button>; }',
  };
  for (const [path, content] of Object.entries(pages)) {
    await mkdir(join(checkout, path, '..'), { recursive: true });
    await writeFile(join(checkout, path), content);
  }
  const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture'); git('add', '-A'); git('commit', '-qm', 'fixture');
  const previous = process.env.PRODUCT_LOCAL_CHECKOUT;
  process.env.PRODUCT_LOCAL_CHECKOUT = checkout;
  try {
    for (const [topic, module, expected, route] of [
      ['Agenda de Contatos', 'Contatos', 'Adicionar Contato', '/contact'],
      ['Criar robô de atendimento', 'Robôs', 'Adicionar Robô', '/bot'],
      ['Cadastrar produto', 'Estoque', 'Adicionar Produto', '/inventory'],
    ]) {
      const result = await searchLocalProductContext(topic, module, { repositoryIds: ['frontend'], cache: false });
      assert.equal(result.code[0].available, true, result.code[0].reason);
      assert.ok(result.code[0].screenFacts.some((fact) => fact.text === expected), `${module}: fato da rota`);
      assert.ok(result.code[0].screenFacts.some((fact) => fact.kind === 'route' && fact.route === route), `${module}: rota`);
    }
    const missing = await searchLocalProductContext('Criar seção', 'Módulo Inexistente', { repositoryIds: ['frontend'], cache: false });
    assert.ok(missing.code[0].screenPending.some((item) => item.includes('tela não identificada para Módulo Inexistente')));
  } finally {
    if (previous === undefined) delete process.env.PRODUCT_LOCAL_CHECKOUT;
    else process.env.PRODUCT_LOCAL_CHECKOUT = previous;
  }
});
