import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeClaims, renderFreeFaqSections } from './faq-editorial.mjs';
import * as editorial from './faq-editorial.mjs';
import * as content from './content-ai-service.mjs';

test('juiz preserva Markdown e título do caso de uso como uma unidade', async () => {
  const examples = [
    '**Encontrar uma pessoa.** Busque pelo contato na lista.',
    'No módulo **Contatos**, digite um nome em **Buscar contato...**.',
    'Veja *mais detalhes* no [guia](https://ihelpchat.com.br/ajuda) e use `Salvar`.',
  ];
  const sections = { casosDeUso: [{ text: examples[0] }], passos: [{ tarefa: 'Buscar', passos: [
    { text: examples[1] }, { text: examples[2] },
  ] }] };
  const seen = [];
  const result = await judgeClaims(sections, { request: { module: 'Contatos' }, business: [{ module: 'Contatos' }] }, async (claims) => {
    seen.push(...claims.map((claim) => claim.text));
    return { claims: claims.map(({ id }) => ({ id, status: 'a confirmar', reason: 'teste' })) };
  });
  assert.deepEqual(seen, examples);
  const body = renderFreeFaqSections(result.sections);
  for (const example of examples) assert.ok(body.includes(`<AConfirmar>${example}</AConfirmar>`), example);
});

test('barreira compila MDX e rejeita marcadores visíveis no texto renderizado', async () => {
  const { validateRenderedFaq } = content;
  assert.equal(typeof validateRenderedFaq, 'function');
  await assert.doesNotReject(validateRenderedFaq('## Casos de uso\n\n<AConfirmar>**Pessoa.** Busque em **Buscar contato...**.</AConfirmar>'));
  for (const body of [
    '<AConfirmar>**Encontrar uma pessoa.</AConfirmar> <AConfirmar>** Busque.</AConfirmar>',
    '<AConfirmar>No módulo **Contatos**, digite em **Buscar contato...</AConfirmar>**.',
    'Em **Buscar contato... **.',
    'Use __solto e `código aberto.',
  ]) await assert.rejects(validateRenderedFaq(body), /MDX|marcador|formata/u, body);
});

test('tarefa curta com fatos de continuação pede nova tentativa e pendência', () => {
  const { shortFreeFaqTasks } = editorial;
  assert.equal(typeof shortFreeFaqTasks, 'function');
  const facts = [
    { kind: 'route', route: '/contact', text: 'Contatos' },
    { kind: 'action', text: 'Editar contato', subject: 'Editar' },
    { kind: 'field', text: 'Nome', subject: 'Editar' },
    { kind: 'action', text: 'Salvar', subject: 'Editar' },
  ];
  const tasks = [{ tarefa: 'Editar', passos: [{ text: 'Clique em **Editar contato**.' }] }];
  assert.deepEqual(shortFreeFaqTasks(tasks, facts), ['passo a passo curto em Editar']);
  assert.deepEqual(shortFreeFaqTasks([{ ...tasks[0], passos: [
    { text: 'No módulo **Contatos**, abra o contato e clique em **Editar contato**.' },
    { text: 'Preencha **Nome** e clique em **Salvar**.' },
  ] }], facts), []);
});
