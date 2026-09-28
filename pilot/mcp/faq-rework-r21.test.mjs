import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { faqSubtitle } from './faq-editorial.mjs';

const sha = 'a'.repeat(40);
const fixtures = [
  { route: '/contact', module: 'Contatos', sentence: 'A tela Contatos organiza as pessoas da sua lista.', expected: 'O módulo Contatos organiza as pessoas da sua lista.' },
  { route: '/bot', module: 'Robôs', sentence: 'A tela Robôs organiza as respostas de atendimento.', expected: 'O módulo Robôs organiza as respostas de atendimento.' },
];

test('subtítulo sustentado usa módulo do menu em Contatos e Robôs sem repetir no corpo', () => {
  for (const fixture of fixtures) {
    const sections = { oQueE: [{ text: `${fixture.sentence} Outra frase de contexto.` }] };
    const facts = [{ kind: 'route', route: fixture.route, text: fixture.module, sha }];
    assert.equal(faqSubtitle(sections, { topic: fixture.module }, facts), fixture.expected);
    assert.equal(sections.oQueE[0].text, 'Outra frase de contexto.');
  }
});

test('ProductAction prefere o nome do menu para Contatos, Robôs e Canais', async () => {
  const source = await readFile(new URL('../components/product-action.tsx', import.meta.url), 'utf8');
  const stripped = source.replace(/^import .*;$/gmu, '').replace('export function ProductAction', 'function ProductAction');
  const compiled = ts.transpileModule(`${stripped}\nreturn ProductAction;`, { compilerOptions: {
    module: ts.ModuleKind.None, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const action = new Function('React', 'ArrowRight', 'productActionUrl', 'allowedActions', 'coverage', 'navigation',
    compiled)({ createElement: (tag, props, ...children) => ({ tag, props, children }) }, () => null,
    () => '/app', {
      contatos: { label: 'Abrir a tela Contatos' }, robos: { label: 'Abrir a tela Robôs' },
      canais: { label: 'Abrir a tela Canais' }, outro: { label: 'Abrir a tela Outro' },
    }, [
      { module: 'Contatos', productRoutes: ['/contact'] },
      { module: 'Robôs', productRoutes: ['/bot'] },
      { module: 'Configurações — canais', productRoutes: ['/configuracoes/channel'] },
      { module: 'Outro', productRoutes: ['/sem-menu'] },
    ], {
      '/contact': 'Contatos', '/bot': 'Robôs', '/configuracoes/channel': 'Canais',
    });
  for (const [id, route, module] of [
    ['contatos', '/contact', 'Contatos'], ['robos', '/bot', 'Robôs'],
    ['canais', '/configuracoes/channel', 'Canais'],
  ]) assert.equal(action({ id, route }).children[0], `Abrir o módulo ${module}`);
  assert.equal(action({ id: 'outro', route: '/sem-menu' }).children[0], 'Abrir o módulo Outro');
});
