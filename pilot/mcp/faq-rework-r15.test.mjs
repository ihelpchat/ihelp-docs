import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScreenFacts, FRONT_ROUTER } from './front-screen-facts.mjs';
import { adaptScreenFacts, deterministicFaqAnswer, fixedFaqSupportSection,
  renderFaqSections, validateFaqSections } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const sha = 'a'.repeat(40);
const nav = 'src/components/ui/components/NavBar/index.tsx';
const router = `const pages = [
  { path: '/bot', title: 'Bot', element: <Robots /> },
  { path: '/contact', title: 'Contact', element: <Contacts /> },
];`;
const menu = `const items = [
  { name: 'Robôs', route: '/bot' },
  { name: 'Contatos', route: '/contact' },
];`;

test('nome visível vem do item de menu com a mesma rota', async () => {
  for (const [route, expected] of [['/bot', 'Robôs'], ['/contact', 'Contatos']]) {
    const sources = { [FRONT_ROUTER]: router, [nav]: menu };
    const screen = await extractScreenFacts({ route, module: expected, topic: expected,
      paths: Object.keys(sources), readSource: async (path) => sources[path], sha });
    const facts = adaptScreenFacts(screen);
    assert.equal(facts.find((fact) => fact.kind === 'route')?.text, expected);
    assert.equal(facts.find((fact) => fact.kind === 'route')?.path, nav);
    const request = { topic: expected, description: `Criar ${expected} e publicar.` };
    const direct = deterministicFaqAnswer(request, [...facts, { kind: 'action', text: 'Criar',
      repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', lineStart: 3, lineEnd: 3, sha }]);
    assert.match(direct.text, new RegExp(`No módulo \\*\\*${expected}\\*\\*`));
    assert.match(fixedFaqSupportSection(request, facts)[0].text,
      new RegExp(`concluir um passo no módulo ${expected}`));
  }
});

test('sem item de menu, nome do módulo da coverage-matrix substitui título interno', () => {
  const facts = adaptScreenFacts({ sha, facts: [
    { kind: 'route', text: 'Bot', route: '/bot', source: 'src/Router.tsx:3' },
  ] }, [{ module: 'Robôs', productRoutes: ['/bot'] }]);
  assert.equal(facts[0].text, 'Robôs');
});

test('passos removem aberturas repetidas da mesma tela e ações iguais consecutivas', () => {
  const facts = adaptScreenFacts({ sha, facts: [
    { kind: 'route', text: 'Robôs', route: '/bot', source: 'src/Router.tsx:1' },
    { kind: 'action', text: 'Criar novo robô', source: 'src/Robots.tsx:2' },
    { kind: 'field', text: 'Título do robô', source: 'src/Robots.tsx:3' },
  ] });
  const result = validateFaqSections({ passos: [
    { acao: 'abrir', fato: 'f1' }, { acao: 'clicar', fato: 'f2' },
    { acao: 'abrir', fato: 'f1' }, { acao: 'abrir', fato: 'f1' },
    { acao: 'preencher', fato: 'f3' }, { acao: 'preencher', fato: 'f3' },
  ] }, { screenFacts: facts });
  assert.deepEqual(result.sections.passos.map((item) => item.text), [
    'Abra **Robôs**.', 'Clique em **Criar novo robô**.', 'Preencha **Título do robô**.',
  ]);
  assert.equal(renderFaqSections(result.sections).match(/Abra \*\*Robôs\*\*/gu)?.length, 1);
});

test('rotas internas diferentes com o mesmo nome visível não reabrem a mesma tela', () => {
  const facts = adaptScreenFacts({ sha, facts: [
    { kind: 'route', text: 'Contatos', route: '/contact', source: 'src/Router.tsx:1' },
    { kind: 'route', text: 'Contatos', route: '/contact/detail/:idRef', source: 'src/Router.tsx:2' },
    { kind: 'action', text: 'Agendamento', source: 'src/Contact.tsx:3' },
  ] });
  const result = validateFaqSections({ passos: [
    { acao: 'abrir', fato: 'f1' }, { acao: 'clicar', fato: 'f3' },
    { acao: 'abrir', fato: 'f2' },
  ] }, { screenFacts: facts });
  assert.equal(result.sections.passos.filter((item) => item.text === 'Abra **Contatos**.').length, 1);
});

test('placeholder de input só aceita preencher; conferir estado continua válido', () => {
  const facts = adaptScreenFacts({ sha, facts: [
    { kind: 'text', property: 'placeholder', text: 'Digite o título do robô', source: 'src/Robots.tsx:3' },
    { kind: 'state', text: 'Ativo', source: 'src/Robots.tsx:4' },
    { kind: 'text', text: 'Salvar', source: 'src/Robots.tsx:5' },
  ] });
  const check = (acao, fato) => validateFaqSections({ passos: [{ acao, fato }] }, { screenFacts: facts });
  assert.equal(check('conferir', 'f1').sections.passos, undefined);
  assert.match(renderFaqSections(check('preencher', 'f1').sections), /Preencha \*\*Digite o título do robô\*\*/u);
  assert.match(renderFaqSections(check('conferir', 'f2').sections), /Confira \*\*Ativo\*\*/u);
  assert.equal(check('conferir', 'f3').sections.passos, undefined);
});

test('estado com o mesmo rótulo de um botão não vira confira', () => {
  const facts = adaptScreenFacts({ sha, facts: [
    { kind: 'state', text: 'Salvar', source: 'src/Robots.tsx:5' },
    { kind: 'action', text: 'Salvar', source: 'src/Robots.tsx:6' },
  ] });
  const result = validateFaqSections({ passos: [{ acao: 'conferir', fato: 'f1' }] }, { screenFacts: facts });
  assert.equal(result.sections.passos, undefined);
});

test('texto condicional dentro de botão é ação; status condicional continua estado', async () => {
  const page = 'src/components/pages/Robots/index.tsx';
  const sources = {
    [FRONT_ROUTER]: `import Robots from '../../../../pages/Robots';\nconst pages = [{ path: '/bot', title: 'Bot', element: <Robots /> }];`,
    [page]: `export default function Robots() { return <><ButtonIconAction type="submit">{busy ? 'Salvando...' : 'Salvar'}</ButtonIconAction><span>{active ? 'Ativo' : 'Inativo'}</span></>; }`,
  };
  const screen = await extractScreenFacts({ route: '/bot', paths: Object.keys(sources),
    readSource: async (path) => sources[path], sha });
  assert.equal(screen.facts.find((fact) => fact.text === 'Salvar')?.kind, 'action');
  assert.equal(screen.facts.find((fact) => fact.text === 'Ativo')?.kind, 'state');
});

test('conferir placeholder pede nova tentativa para preencher o campo', async () => {
  const source = (kind, text, line, extra = {}) => ({ kind, text, source: `src/Robots.tsx:${line}`,
    repository: 'ihelpchat/front-react', sha, ...extra });
  const context = { groundingRequired: true,
    code: [{ available: true, role: 'frontend', ref: sha, repository: 'ihelpchat/front-react' }],
    matches: [{ repository: 'ihelpchat/front-react', path: 'src/Robots.tsx', line: 2,
      ref: sha, sha, excerpt: '2: Criar novo robô' }],
    screenFacts: [source('route', 'Robôs', 1, { route: '/bot', routeTitle: 'Bot' }),
      source('action', 'Criar novo robô', 2),
      source('text', 'Digite o título do robô', 3, { property: 'placeholder' }),
      source('action', 'Salvar', 4), source('action', 'Publicar', 5), source('state', 'Ativo', 6)],
    support: { categories: [], rules: [] }, coverage: [], pending: [], businessContext: [], faqStyleExamples: [] };
  const reply = (acao) => ({ status: 'ready', summary: 'FAQ.', questions: [], articles: [{
    path: 'docs/robo', title: 'Robô de atendimento', description: 'Resumo.', source: 'produto', contentType: 'faq',
    productActions: [], assistantQuestion: 'Como usar a tela Bot?',
    sections: { resposta: [], paraQueServe: [], quandoUsar: [], exemplo: [], duvidas: [], erros: [], suporte: [],
      passos: [{ acao: 'abrir', fato: 'f1' }, { acao: 'clicar', fato: 'f2' }, { acao, fato: 'f3' },
        { acao: 'clicar', fato: 'f4' }, { acao: 'clicar', fato: 'f5' }, { acao: 'conferir', fato: 'f6' }] },
  }] });
  let calls = 0, retryPrompt = '';
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
    { topic: 'Robô de atendimento', module: 'Robôs', description: 'Criar FAQ para criar e publicar um robô.' }, {
      productContext: context, plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
        calls++;
        if (calls === 2) retryPrompt = JSON.stringify(payload.input);
        return { model: 'fixture', output_text: JSON.stringify(reply(calls === 1 ? 'conferir' : 'preencher')) };
      } } },
    });
  assert.equal(calls, 2);
  assert.equal(retryPrompt.includes('conferir em campo'), true);
  assert.equal(result.status, 'ready', JSON.stringify(result.questions));
  assert.match(result.articles[0].body, /Preencha \*\*Digite o título do robô\*\*/u);
  assert.doesNotMatch(result.articles[0].body, /Confira \*\*Digite o título do robô\*\*/u);
  assert.equal(result.articles[0].assistantQuestion, 'Como usar o módulo Robôs?');
});
