import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFaqSections, missingFaqTaskSteps } from './faq-editorial.mjs';
import { generateContentPackage } from './content-ai-service.mjs';

const sha = 'a'.repeat(40);
const fact = (text, line, kind = 'action') => ({ kind, text, repository: 'ihelpchat/front-react',
  path: 'src/Fixture.tsx', lineStart: line, lineEnd: line, sha });
const cite = (line) => ({ repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx',
  lineStart: line, lineEnd: line, sha });
const unit = (text, line) => ({ text, citations: [cite(line)] });
const createStep = unit('Clique em Criar novo robô; na tela, confira Criar novo robô antes de continuar; volte ao botão Criar novo robô se precisar começar a tarefa outra vez.', 2);
const createStep2 = unit('Confira **Criar novo robô** antes de seguir; procure esse mesmo rótulo na tela e clique nele para abrir a próxima etapa.', 2);
const createStep3 = unit('Volte à tela anterior e escolha **Criar novo robô** para recomeçar; confira o nome do botão antes de continuar.', 2);
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
    createStep, unit('Digite em Digite o título do robô.', 3),
    unit('Clique em Salvar.', 4), unit('Clique em Publicar.', 5),
  ])]);
  const { result, prompts } = await run([raw]);
  assert.equal(result.status, 'ready', JSON.stringify(result));
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].contentType, 'faq');
  assert.match(result.articles[0].body, /\*\*Criar novo robô\*\*/u);
  assert.match(result.articles[0].body, /\*\*Publicar\*\*/u);
  assert.ok(prompts[0].includes('Criar novo robô'));
  assert.ok(result.pending.some((item) => item.includes('seção sem fonte de negócio:')));
});

test('tarefa com fatos e sem passo entra no retry uma vez e depois vira pendência', async () => {
  const partial = packageOf([article('docs/robo', 'faq', [createStep, createStep2, createStep3])]);
  const { result, calls, prompts } = await run([partial, partial]);
  assert.equal(calls, 2);
  assert.match(prompts[1], /tarefa sem passo: editar/u);
  assert.match(prompts[1], /tarefa sem passo: ativar/u);
  assert.equal(result.status, 'ready', JSON.stringify(result));
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
  const repeated = packageOf([article('docs/robo', 'faq', [createStep, createStep2, createStep3]),
    article('tutoriais/robo', 'tutorial', [createStep])]);
  const { result } = await run([repeated]);
  assert.equal(result.articles.length, 1, JSON.stringify(result));
  assert.equal(result.articles[0].contentType, 'faq');
});

test('Agenda cobra busca, importação e agendamento quando há fatos dessas tarefas', () => {
  const agenda = { details: 'Cobrir buscar, cadastrar, importar e agendar mensagem.' };
  const screen = [fact('Buscar contato...', 11, 'field'), fact('Adicionar Contato', 12),
    fact('Mais opções', 13), fact('Importar Contatos', 14), fact('.csv, .xlsx, .xls', 15, 'upload'),
    fact('Agendamento', 16)];
  assert.deepEqual(missingFaqTaskSteps(agenda, screen, [unit('Clique em **Adicionar Contato**.', 12)]).sort(),
    ['tarefa sem passo: buscar', 'tarefa sem passo: importar', 'tarefa sem passo: agendar'].sort());
  assert.deepEqual(missingFaqTaskSteps(agenda, screen, [unit('Clique em **Buscar contato...**.', 11),
    unit('Clique em **Adicionar Contato**.', 12), unit('Abra **Importar Contatos**.', 14),
    unit('Clique em **Agendamento**.', 16)]), []);
});
