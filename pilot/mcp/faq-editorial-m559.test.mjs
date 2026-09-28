import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFaqQuestions, selectFaqStyleExamples, loadBusinessContext,
  adaptScreenFacts, validateFaqSections } from './faq-editorial.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';

const unit = (text, citations) => ({ text, citations });
test('FAQ só bloqueia dúvida sobre resposta direta ou passo principal', () => {
  const result = classifyFaqQuestions([
    'Como entrar na tela de Contatos para cadastrar?',
    'Qual formato de telefone internacional é aceito?',
    'Qual arquivo sai da exportação?',
  ]);
  assert.equal(result.blocking.length, 1);
  assert.equal(result.pending.length, 2);
});

test('seção sem citação é omitida com pendência; quote não literal é recusado', () => {
  const context = { request: { description: 'Cadastre contatos pela tela Contatos.' },
    support: { categories: [{ category: 'Gestão de contatos', guidance: 'Cobrir importação e validação do resultado.' }] },
    business: [{ path: 'business-context/publico.md', body: '🟢 PÚBLICO\nOrganizar clientes evita retrabalho.' }],
    existing: [], screenFacts: [] };
  const sections = { resposta: [unit('Abra Contatos para cadastrar.', [{ source: 'pedido', quote: 'Cadastre contatos pela tela Contatos.' }])],
    paraQueServe: [unit('Organize os clientes.', [])],
    duvidas: [unit('Confira a importação.', [{ source: 'suporte', quote: 'Cobrir importação e validação do resultado.' }])],
    quandoUsar: [unit('Isso aumenta as vendas.', [{ source: 'negocio', path: 'business-context/publico.md', quote: 'aumenta as vendas' }])] };
  const result = validateFaqSections(sections, context);
  assert.deepEqual(Object.keys(result.sections), ['resposta', 'duvidas']);
  assert.ok(result.pending.some((item) => item.includes('Para que serve')));
  assert.ok(result.pending.some((item) => item.includes('Quando usar')));
  const traversal = validateFaqSections({ paraQueServe: [unit('Organize clientes.', [{ source: 'negocio', path: '../private.md', quote: 'Organizar clientes evita retrabalho.' }])] },
    { ...context, business: [...context.business, { path: '../private.md', body: 'Organizar clientes evita retrabalho.' }] });
  assert.equal(traversal.sections.paraQueServe, undefined);
  const uncited = validateFaqSections({ resposta: [unit('Abra Contatos.', [])] }, context);
  assert.equal(uncited.sections.resposta, undefined);
  const falseSupport = validateFaqSections({ duvidas: [unit('Como importar?', [{ source: 'suporte', quote: 'O suporte garante importação sem erros.' }])] }, context);
  assert.equal(falseSupport.sections.duvidas, undefined);
});

test('few-shot usa três páginas e reage à edição', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faq-style-'));
  try {
    await mkdir(join(root, 'sobre-o-sistema'), { recursive: true });
    for (let i = 0; i < 4; i++) await writeFile(join(root, 'sobre-o-sistema', `${i}.mdx`),
      `---\ntitle: Guia ${i}\nsource: produto\ncontentType: faq\n---\n${'## Seção\n1. Faça um passo.\nExemplo: Maria Exemplo.\n'.repeat(i + 1)}`);
    const before = await selectFaqStyleExamples(root);
    assert.equal(before.length, 3);
    await writeFile(join(root, 'sobre-o-sistema', '0.mdx'),
      '---\ntitle: Guia novo\nsource: produto\ncontentType: faq\n---\n' + '## Seção\n1. Faça um passo.\nExemplo: Maria Exemplo.\n'.repeat(6));
    const after = await selectFaqStyleExamples(root);
    assert.equal(after[0].path, 'docs/sobre-o-sistema/0');
    assert.notDeepEqual(after, before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('negócio começa vazio e fatos da tela mantêm proveniência', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faq-business-'));
  try {
    await mkdir(join(root, 'business-context'));
    await writeFile(join(root, 'business-context', 'README.md'), 'Formato público');
    assert.deepEqual(await loadBusinessContext(root), []);
    await writeFile(join(root, 'business-context', 'publico.md'), '🟢 PÚBLICO\nA equipe ganha tempo.');
    await writeFile(join(root, 'business-context', 'interno.md'), '🟡 INTERNO\nNão publicar.');
    assert.equal((await loadBusinessContext(root)).length, 1);
    const facts = adaptScreenFacts({ facts: [{ kind: 'action', text: 'Adicionar Contato', source: 'src/Contact.tsx:12', subject: 'cadastro contato' }], sha: 'a'.repeat(40) });
    assert.equal(facts[0].lineStart, 12);
    assert.equal(facts[0].text, 'Adicionar Contato');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('passo exige rótulo literal do fato da tela e erro exige mensagem validada', () => {
  const sha = 'a'.repeat(40);
  const facts = adaptScreenFacts({ sha, facts: [
    { kind: 'action', text: 'Adicionar Contato', source: 'src/Contact.tsx:12' },
    { kind: 'validation', text: 'Nome obrigatório', source: 'src/Contact.tsx:13' },
  ] });
  const citation = (line) => ({ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: line, lineEnd: line, sha });
  const result = validateFaqSections({ passos: [unit('Clique em Novo cliente.', [citation(12)])],
    erros: [unit('Se aparecer Nome obrigatório, preencha o nome.', [citation(13)])] }, { screenFacts: facts });
  assert.equal(result.sections.passos, undefined);
  assert.equal(result.sections.erros.length, 1);
});

test('pacote FAQ fica ready com dúvida secundária pendente e seção sem fonte omitida', async () => {
  const sha = 'a'.repeat(40);
  const citation = { repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: 12, lineEnd: 12, sha };
  const sections = Object.fromEntries(['resposta', 'paraQueServe', 'quandoUsar', 'passos', 'exemplo', 'duvidas', 'erros', 'suporte'].map((key) => [key, []]));
  sections.resposta = [unit('Abra Contatos no menu e clique em Adicionar Contato para cadastrar uma pessoa da sua lista.', [citation])];
  sections.passos = [
    unit('Abra Contatos no menu lateral e localize Adicionar Contato antes de iniciar um novo cadastro.', [citation]),
    unit('Clique em Adicionar Contato e preencha os campos mostrados na tela para iniciar o cadastro.', [citation]),
    unit('Confira as informações de Adicionar Contato antes de avançar e volte à lista para localizar o cadastro.', [citation]),
  ];
  const reply = { status: 'ready', summary: 'Página pronta.', questions: [], articles: [{
    path: 'docs/sobre-o-sistema/contatos-novos', title: 'Contatos novos', description: 'Descrição gerada pelo modelo.',
    source: 'produto', contentType: 'faq', sections, productActions: [],
    assistantQuestion: 'Como cadastrar uma pessoa?',
  }] };
  const context = { groundingRequired: true,
    matches: [{ ...citation, line: 12, ref: sha, excerpt: '12: Adicionar Contato' }],
    code: [{ available: true, role: 'frontend', ref: sha, repository: 'ihelpchat/front-react' }],
    screenFacts: [{ kind: 'action', text: 'Adicionar Contato', source: 'src/Contact.tsx:12', repository: 'ihelpchat/front-react', sha }],
    support: { categories: [], rules: [] }, coverage: [], pending: [], businessContext: [], faqStyleExamples: [] };
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
    { topic: 'Contatos', module: 'Contatos', description: 'Criar FAQ para cadastrar contatos.' },
    { productContext: context, plan: { status: 'ready', pending: ['pergunta pendente: Qual formato do telefone?'] },
      client: { responses: { create: async (payload) => {
        assert.ok(payload.text.format.schema.properties.articles.items.properties.sections);
        assert.ok(!payload.text.format.schema.properties.articles.items.properties.body);
        return { model: 'fixture', output_text: JSON.stringify(reply) };
      } } } });
  assert.equal(result.status, 'ready', JSON.stringify(result.questions));
  assert.match(result.articles[0].body, /^Abra Contatos/u);
  assert.doesNotMatch(result.articles[0].body, /Erros comuns/u);
  assert.ok(result.pending.some((item) => item.includes('Qual formato do telefone')));
  assert.ok(result.pending.some((item) => item.includes('Erros comuns')));
});

test('plano da Agenda sai ready quando só pergunta detalhes secundários', async () => {
  const context = { groundingRequired: true,
    code: [{ available: true, repository: 'ihelpchat/front-react', ref: 'a'.repeat(40), role: 'frontend' }],
    matches: [{ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', line: 12,
      ref: 'a'.repeat(40), sha: 'a'.repeat(40), excerpt: '12: Adicionar Contato' }],
    screenFacts: [], support: { categories: [], rules: [] }, coverage: [], pending: [],
    businessContext: [], faqStyleExamples: [] };
  const client = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
    status: 'needs_information', guidance: 'A tela mostra ações para contatos.',
    questions: ['Na importação, qual formato de telefone internacional é aceito?',
      'Na exportação, qual arquivo é gerado?'], risks: [], suggestedActions: [], grounding: [],
  }) }) } };
  const plan = await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Agenda de Contatos', module: 'Contatos', description: 'Criar a página do FAQ sobre a Agenda de Contatos.' },
    { productContext: context, client });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.questions.length, 0);
  assert.equal(plan.pending.filter((item) => item.startsWith('pergunta pendente:')).length, 2);
});
