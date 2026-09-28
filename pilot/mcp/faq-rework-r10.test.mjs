import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFaqSections } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const sha = 'a'.repeat(40);
const fact = (text, line, kind = 'action') => ({ kind, text, repository: 'ihelpchat/front-react',
  path: 'src/Fixture.tsx', lineStart: line, lineEnd: line, sha });
const cite = (line) => ({ repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx',
  lineStart: line, lineEnd: line, sha });
const unit = (text, line) => ({ text, citations: [cite(line)] });
const sections = (passos = [], erros = []) => ({ resposta: [], paraQueServe: [], quandoUsar: [],
  passos, exemplo: [], duvidas: [], erros, suporte: [] });
const request = { topic: 'Robô de atendimento', module: 'Robôs',
  description: 'Criar a página do FAQ sobre o Robô de atendimento.',
  details: 'Cobrir como criar e editar um robô, montar o fluxo e ativar.' };
const facts = [fact('Robôs', 1, 'route'), fact('Criar novo robô', 2),
  fact('Digite o título do robô', 3, 'field'), fact('Salvar', 4), fact('Publicar', 5),
  fact('Editar robô', 6), fact('Fluxo', 7)];
const context = { groundingRequired: true,
  code: [{ available: true, role: 'frontend', ref: sha, repository: 'ihelpchat/front-react' }],
  matches: [{ ...cite(2), line: 2, ref: sha, excerpt: '2: Criar novo robô' }],
  screenFacts: facts.map(({ repository: _r, path: _p, lineStart, lineEnd: _e, sha: _s, ...rest }) =>
    ({ ...rest, source: `src/Fixture.tsx:${lineStart}` })),
  support: { categories: [], rules: [] }, coverage: [], pending: [], businessContext: [], faqStyleExamples: [] };
const article = (path, contentType, passos) => ({ path, title: 'Robô de atendimento', description: 'Robô de atendimento.',
  source: 'produto', contentType, sections: sections(passos), productActions: [],
  assistantQuestion: 'Como criar um robô?' });
const packageOf = (articles) => ({ status: 'ready', summary: 'Robô.', questions: [], articles });
const run = async (replies) => {
  let calls = 0; const prompts = [];
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname, request,
    { productContext: structuredClone(context), plan: { status: 'ready' }, client: { responses: {
      create: async (payload) => { prompts.push(JSON.stringify(payload.input));
        return { model: 'fixture', output_text: JSON.stringify(replies[Math.min(calls++, replies.length - 1)]) }; },
    } } });
  return { result, calls, prompts };
};

test('replay do Robô conserva passos citados do tutorial no único FAQ pedido', async () => {
  const raw = packageOf([article('docs/robo', 'faq', []), article('tutoriais/robo', 'tutorial', [
    unit('Clique em Criar novo robô.', 2), unit('Digite em Digite o título do robô.', 3),
    unit('Clique em Salvar.', 4), unit('Clique em Publicar.', 5),
  ])]);
  const { result, prompts } = await run([raw]);
  assert.equal(result.status, 'ready');
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].contentType, 'faq');
  assert.match(result.articles[0].body, /\*\*Criar novo robô\*\*/u);
  assert.match(result.articles[0].body, /\*\*Publicar\*\*/u);
  assert.ok(prompts[0].includes('Criar novo robô'));
});

test('tarefa com fatos e sem passo entra no retry uma vez e depois vira pendência', async () => {
  const partial = packageOf([article('docs/robo', 'faq', [unit('Clique em Criar novo robô.', 2)])]);
  const { result, calls, prompts } = await run([partial, partial]);
  assert.equal(calls, 2);
  assert.match(prompts[1], /tarefa sem passo: editar/u);
  assert.match(prompts[1], /tarefa sem passo: ativar/u);
  assert.equal(result.status, 'ready');
  assert.ok(result.pending.some((item) => item.includes('tarefa sem passo: editar')));
});

test('erro aceita a mensagem exata citada e recusa mensagem inventada', () => {
  const error = fact('O nome é obrigatório', 8, 'validation');
  const ctx = { screenFacts: [...facts, error] };
  const good = validateFaqSections({ erros: [unit('**O nome é obrigatório**.', 8)] }, ctx);
  assert.equal(good.sections.erros?.length, 1);
  const helpful = validateFaqSections({ erros: [unit('No cadastro, a tela mostra **O nome é obrigatório** quando apresenta a validação do nome.', 8)] }, ctx);
  assert.equal(helpful.sections.erros?.length, 1);
  const bad = validateFaqSections({ erros: [unit('**O telefone é obrigatório**.', 8)] }, ctx);
  assert.equal(bad.sections.erros, undefined);
});

test('pedido simples gera só uma página mesmo se modelo devolver FAQ e tutorial', async () => {
  const repeated = packageOf([article('docs/robo', 'faq', [unit('Clique em Criar novo robô.', 2)]),
    article('tutoriais/robo', 'tutorial', [unit('Clique em Criar novo robô.', 2)])]);
  const { result } = await run([repeated]);
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].contentType, 'faq');
});
