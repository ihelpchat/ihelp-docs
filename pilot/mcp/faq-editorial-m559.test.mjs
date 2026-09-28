import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFaqQuestions, selectFaqStyleExamples, loadBusinessContext,
  adaptScreenFacts, validateFaqSections } from './faq-editorial.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';
import { FAQ_NEUTRAL_WORDS } from './faq-neutral-words.mjs';

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
  const sections = { resposta: [unit('Abra a tela Contatos.', [{ source: 'pedido', quote: 'Cadastre contatos pela tela Contatos.' }])],
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

test('resposta sem citação é recusada mesmo sem palavras que exijam cobertura lexical', () => {
  const sentence = 'Clique na tela.';
  const context = { request: { description: sentence } };
  const cited = validateFaqSections({ resposta: [unit(sentence, [
    { source: 'pedido', quote: sentence },
  ])] }, context);
  assert.equal(cited.sections.resposta?.length, 1);

  const uncited = validateFaqSections({ resposta: [unit(sentence, [])] }, context);
  assert.equal(uncited.sections.resposta, undefined);
  assert.deepEqual(uncited.blocking, ['resposta', 'passos']);
  assert.ok(uncited.pending.includes('seção sem fonte válida: Resposta direta'));
  assert.ok(!uncited.pending.some((item) => item.startsWith('palavra sem fonte:')));
});

test('quote literal de negócio é recusado quando o path sai da pasta permitida', () => {
  const sentence = 'Organizar clientes evita retrabalho.';
  const context = { business: [
    { path: 'business-context/publico.md', body: sentence },
    { path: '../private.md', body: sentence },
  ] };
  const check = (path) => validateFaqSections({ paraQueServe: [unit(sentence, [
    { source: 'negocio', path, quote: sentence },
  ])] }, context);
  assert.equal(check('business-context/publico.md').sections.paraQueServe?.length, 1);

  const outside = check('../private.md');
  assert.equal(outside.sections.paraQueServe, undefined);
  assert.ok(outside.pending.includes('seção sem fonte válida: Para que serve'));
  assert.ok(!outside.pending.some((item) => item.startsWith('palavra sem fonte:')));
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
    const selected = before[0];
    const selectedFile = join(root, selected.path.replace(/^docs\//u, '') + '.mdx');
    const original = await (await import('node:fs/promises')).readFile(selectedFile, 'utf8');
    await writeFile(selectedFile, original.replace('Faça um passo.', 'Abra a agenda e confirme o contato.'));
    const changed = await selectFaqStyleExamples(root);
    assert.notEqual(changed.find((item) => item.path === selected.path).style, selected.style);
    assert.match(changed.find((item) => item.path === selected.path).style, /Abra a agenda/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('contexto público sob a raiz pilot chega ao prompt e pode ser citado', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faq-pilot-'));
  try {
    await mkdir(join(root, 'architecture', 'business-context'), { recursive: true });
    await writeFile(join(root, 'architecture', 'business-context', 'publico.md'),
      '🟢 PÚBLICO\nOrganizar contatos evita retrabalho da equipe.');
    const context = { groundingRequired: true, matches: [{ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx',
      line: 12, ref: 'a'.repeat(40), sha: 'a'.repeat(40), excerpt: '12: Adicionar Contato' }],
      code: [{ available: true, repository: 'ihelpchat/front-react', ref: 'a'.repeat(40), role: 'frontend' }],
      screenFacts: [], support: { categories: [], rules: [] }, coverage: [], pending: [] };
    let prompt = '';
    await planContent(root, { topic: 'Contatos', module: 'Contatos', description: 'Criar FAQ para cadastrar contatos.' }, {
      productContext: context, client: { responses: { create: async (payload) => {
        prompt = payload.input[1].content;
        return { model: 'fixture', output_text: JSON.stringify({ status: 'ready', guidance: '', questions: [],
          risks: [], suggestedActions: [], grounding: [] }) };
      } } },
    });
    assert.match(prompt, /Organizar contatos evita retrabalho da equipe/u);
    assert.equal(validateFaqSections({ paraQueServe: [unit('Organizar contatos evita retrabalho.', [
      { source: 'negocio', path: 'business-context/publico.md', quote: 'Organizar contatos evita retrabalho da equipe.' },
    ])] }, { business: context.businessContext }).sections.paraQueServe?.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('SHA do front com dez dígitos consecutivos chega íntegro ao prompt e valida a citação', async () => {
  for (const sha of ['a'.repeat(15) + '9136328159' + 'b'.repeat(15), '1234567890'.repeat(4)]) {
  const fact = { kind: 'action', text: 'Criar novo robô', source: 'src/Fixture.tsx:12',
    repository: 'ihelpchat/front-react', sha };
  const context = { groundingRequired: true,
    code: [{ available: true, role: 'frontend', repository: fact.repository, ref: sha }],
    matches: [{ repository: fact.repository, path: 'src/Fixture.tsx', line: 12, ref: sha, sha,
      excerpt: '12: Criar novo robô' }], screenFacts: [fact],
    support: { categories: [], rules: [] }, coverage: [], pending: [] };
  let prompt = '';
  await planContent(new URL('../', import.meta.url).pathname,
    { topic: 'Robô', module: 'Robôs', description: 'Criar FAQ para o robô.' }, {
      productContext: context, client: { responses: { create: async (payload) => {
        prompt = payload.input[1].content;
        return { model: 'fixture', output_text: JSON.stringify({ status: 'ready', guidance: '', questions: [],
          risks: [], suggestedActions: [], grounding: [] }) };
      } } },
    });
  assert.ok(prompt.includes(sha));
  assert.equal(prompt.includes('[dado removido]'), false);
  const citation = { repository: fact.repository, path: 'src/Fixture.tsx', lineStart: 12, lineEnd: 12, sha };
  assert.equal(validateFaqSections({ passos: [unit('Clique em Criar novo robô.', [citation])] },
    { screenFacts: adaptScreenFacts({ facts: [fact], sha }) }).sections.passos?.length, 1);
  }
});

test('citação aceita faixa curta contendo o fato da tela', () => {
  const sha = 'a'.repeat(15) + '9136328159' + 'b'.repeat(15);
  const facts = adaptScreenFacts({ sha, facts: [{ kind: 'action', text: 'Criar novo robô',
    source: 'src/Fixture.tsx:12' }] });
  const cite = { repository: 'ihelpchat/front-react', path: 'src/Fixture.tsx', sha,
    lineStart: 10, lineEnd: 14 };
  assert.equal(validateFaqSections({ passos: [unit('Clique em Criar novo robô.', [cite])] },
    { screenFacts: facts }).sections.passos?.length, 1);
  assert.equal(validateFaqSections({ passos: [unit('Clique em Criar novo robô.', [
    { ...cite, lineStart: 15, lineEnd: 16 }])] }, { screenFacts: facts }).sections.passos, undefined);
});

test('quote exige ao menos 12 caracteres', () => {
  const context = { request: { description: 'Contatos bons ajudam a equipe.' } };
  const check = (quote) => validateFaqSections({ resposta: [unit('Abra Contatos.', [
    { source: 'pedido', quote },
  ])] }, context).sections.resposta?.length ?? 0;
  assert.equal(check('Contatos bo'), 0);
  assert.equal(check('Contatos bon'), 1);
});

test('afirmações de negócio exigem números, promessa e todas as palavras sustentados', () => {
  const text = 'Cadastre contatos pela tela Contatos.';
  const context = { request: { description: text }, business: [] };
  const check = (sentence, quote = text, source = 'pedido', extra = {}) => validateFaqSections({
    paraQueServe: [unit(sentence, [{ source, quote, ...extra }])],
  }, context);
  const unsupported = check('Isso aumenta as vendas em 50%.');
  assert.equal(unsupported.sections.paraQueServe, undefined);
  assert.ok(unsupported.pending.some((item) => item.startsWith('palavra sem fonte:') && item.includes('50')));
  context.request.description = 'Cadastrar contatos aumenta as vendas.';
  assert.equal(check('Cadastrar contatos aumenta as vendas em 50%.', context.request.description).sections.paraQueServe, undefined);
  context.request.description = 'Cadastre contatos organizados para a equipe.';
  assert.equal(check('Cadastre contatos organizados e garante a equipe.', context.request.description).sections.paraQueServe, undefined);
  const businessQuote = 'Cadastrar contatos aumenta as vendas em 50%.';
  const supported = check('Cadastrar contatos aumenta as vendas em 50%.', businessQuote, 'negocio',
    { path: 'business-context/publico.md' });
  assert.equal(supported.sections.paraQueServe, undefined);
  context.business = [{ path: 'business-context/publico.md', body: `🟢 PÚBLICO\n${businessQuote}` }];
  assert.equal(check('Cadastrar contatos aumenta as vendas em 50%.', businessQuote, 'negocio',
    { path: 'business-context/publico.md' }).sections.paraQueServe?.length, 1);
  assert.equal(check('Isso garante contatos organizados.').sections.paraQueServe, undefined);
  context.request.description = text;
  assert.equal(check('Cadastre os contatos pela tela Contatos.').sections.paraQueServe?.length, 1);
  assert.equal(check('Cadastre os contatos pela tela AgendaNova.').sections.paraQueServe, undefined);
  assert.equal(check('Cadastre contatos para organizar equipes modernas e campanhas futuras.').sections.paraQueServe, undefined);
  assert.equal(check('Campanhas reduzem custos e ampliam receitas pela tela Contatos.').sections.paraQueServe, undefined);
});

test('negócio começa vazio e fatos da tela mantêm proveniência', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faq-business-'));
  try {
    await mkdir(join(root, 'architecture', 'business-context'), { recursive: true });
    await writeFile(join(root, 'architecture', 'business-context', 'README.md'), 'Formato público');
    assert.deepEqual(await loadBusinessContext(root), []);
    await writeFile(join(root, 'architecture', 'business-context', 'publico.md'), '🟢 PÚBLICO\nA equipe ganha tempo.');
    await writeFile(join(root, 'architecture', 'business-context', 'interno.md'), '🟡 INTERNO\nNão publicar.');
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
    { kind: 'field', name: 'name', text: 'Nome', required: true, owner: 'ContactPage',
      message: 'Preencha o nome', source: 'src/Contact.tsx:14',
      validationSource: 'src/ContactSchema.ts:7' },
  ] });
  const citation = (line) => ({ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: line, lineEnd: line, sha });
  const result = validateFaqSections({ passos: [unit('Clique em Novo cliente.', [citation(12)])],
    erros: [unit('Nome obrigatório. Preencha o nome.', [citation(13),
      { ...citation(14), path: 'src/ContactSchema.ts', lineStart: 7, lineEnd: 7 }])] }, { screenFacts: facts });
  assert.equal(result.sections.passos, undefined);
  assert.equal(result.sections.erros.length, 1);
  assert.ok(facts.some((fact) => fact.kind === 'message' && fact.path === 'src/ContactSchema.ts'
    && fact.lineStart === 7 && fact.text === 'Preencha o nome'));
});

test('required real de M5.58 governa afirmações em passos e dúvidas', () => {
  const sha = 'a'.repeat(40);
  const citation = { repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: 12, lineEnd: 12, sha };
  const supportQuote = 'Nome obrigatório. Nome opcional.';
  for (const required of [true, false, 'unknown']) {
    const facts = adaptScreenFacts({ sha, facts: [{ kind: 'field', name: 'name', text: 'Nome', required,
      source: 'src/Contact.tsx:12', owner: 'ContactPage', subject: 'contato' }] });
    const context = { screenFacts: facts, support: { categories: [{ category: 'Contatos', guidance: supportQuote }] } };
    for (const [word, permitted] of [['obrigatório', required === true], ['opcional', required === false]]) {
      const sentence = `Nome ${word}.`;
      const sections = { passos: [unit(sentence, [citation])],
        duvidas: [unit(sentence, [{ source: 'suporte', quote: supportQuote }])] };
      const result = validateFaqSections(sections, context);
      for (const key of ['passos', 'duvidas']) assert.equal(Boolean(result.sections[key]), permitted,
        `${key}: required=${required}, ${word}`);
    }
    assert.equal(validateFaqSections({ passos: [unit('Nome.', [citation])] }, context).sections.passos?.length, 1);
  }
  const distinct = adaptScreenFacts({ sha, facts: [
    { kind: 'field', name: 'name', text: 'Nome', required: 'unknown', source: 'src/Contact.tsx:12' },
    { kind: 'field', name: 'surname', text: 'Sobrenome', required: true, source: 'src/Contact.tsx:13' },
  ] });
  assert.equal(validateFaqSections({ passos: [unit('Sobrenome obrigatório.', [{ ...citation,
    lineStart: 13, lineEnd: 13 }])] }, { screenFacts: distinct }).sections.passos?.length, 1);
});

test('obrigatoriedade vinda do schema usa a linha do schema como fonte', () => {
  const sha = 'a'.repeat(40);
  const facts = adaptScreenFacts({ sha, facts: [{ kind: 'field', name: 'name', text: 'Nome',
    required: true, source: 'src/Contact.tsx:12', validationSource: 'src/ContactSchema.ts:7' }] });
  const cite = (path, lineStart) => ({ repository: 'ihelpchat/front-react', path, lineStart, lineEnd: lineStart, sha });
  const check = (citation) => validateFaqSections({ passos: [unit('Nome obrigatório.', [citation])] }, { screenFacts: facts });
  assert.equal(check(cite('src/Contact.tsx', 12)).sections.passos, undefined);
  assert.equal(check(cite('src/ContactSchema.ts', 7)).sections.passos?.length, 1);
});

test('cobertura integral vale para resposta e passos, com uma alteração por negativo', () => {
  const sha = 'a'.repeat(40);
  const fact = { repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: 12,
    lineEnd: 12, sha, kind: 'action', text: 'Adicionar Contato' };
  const citation = (({ repository, path, lineStart, lineEnd, sha: revision }) =>
    ({ repository, path, lineStart, lineEnd, sha: revision }))(fact);
  const context = { screenFacts: [fact] };
  const sentence = 'Clique em Adicionar Contato.';
  const check = (text) => validateFaqSections({ resposta: [unit(text, [citation])],
    passos: [unit(text, [citation])] }, context);
  const accepted = check(sentence);
  assert.equal(accepted.sections.resposta?.length, 1);
  assert.equal(accepted.sections.passos?.length, 1);
  const rejected = check('Clique em Adicionar Contato e suas vendas dobram em 30 dias.');
  assert.equal(rejected.sections.resposta, undefined);
  assert.equal(rejected.sections.passos, undefined);
  assert.deepEqual(rejected.blocking, ['resposta', 'passos']);
  assert.ok(rejected.pending.some((item) => /palavra sem fonte: .*vendas.*dobram.*30.*dias/u.test(item)));
});

test('palavra nova no fim da frase reprova todas as seções, inclusive exemplo', () => {
  const quote = 'Organizar contatos da equipe evita retrabalho no atendimento';
  const context = { business: [{ path: 'business-context/publico.md', body: `🟢 PÚBLICO\n${quote}` }] };
  const cite = { source: 'negocio', path: 'business-context/publico.md', quote };
  const positive = 'Organizar contatos da equipe evita retrabalho no atendimento.';
  const negative = 'Organizar contatos da equipe evita retrabalho e bloqueia clientes inadimplentes no atendimento.';
  for (const key of ['paraQueServe', 'quandoUsar', 'suporte']) {
    assert.equal(validateFaqSections({ [key]: [unit(positive, [cite])] }, context).sections[key]?.length, 1, key);
    const rejected = validateFaqSections({ [key]: [unit(negative, [cite])] }, context);
    assert.equal(rejected.sections[key], undefined, key);
    assert.ok(rejected.pending.some((item) => /palavra sem fonte: .*bloqueia.*clientes.*inadimplentes/u.test(item)), key);
  }
  const synthetic = 'Maria Exemplo pode organizar contatos da equipe e evita retrabalho no atendimento.';
  assert.equal(validateFaqSections({ exemplo: [unit(synthetic, [cite])] }, context).sections.exemplo?.length, 1);
  assert.equal(validateFaqSections({ exemplo: [unit(`${synthetic.slice(0, -1)} e bloqueia clientes inadimplentes.`, [cite])] }, context).sections.exemplo, undefined);
});

test('dúvidas e erros rejeitam palavra sem fonte; plural e acento usam a mesma normalização', () => {
  assert.ok(FAQ_NEUTRAL_WORDS.length >= 190);
  assert.ok(!FAQ_NEUTRAL_WORDS.some((word) => /vendas|clientes|inadimplentes|bloqueia/iu.test(word)));
  const sha = 'a'.repeat(40);
  const fact = { kind: 'validation', text: 'Número obrigatório', repository: 'ihelpchat/front-react',
    path: 'src/Contact.tsx', lineStart: 12, lineEnd: 12, sha };
  const citation = { repository: fact.repository, path: fact.path, lineStart: 12, lineEnd: 12, sha };
  const context = { screenFacts: [fact], support: { categories: [{ category: 'Contatos',
    guidance: 'Clientes não recebem números inválidos.' }] } };
  const cases = [
    ['duvidas', 'Clientes não recebem números inválidos.',
      { source: 'suporte', quote: 'Clientes não recebem números inválidos.' }],
    ['erros', 'Número obrigatório.', citation],
  ];
  for (const [key, positive, cite] of cases) {
    assert.equal(validateFaqSections({ [key]: [unit(positive, [cite])] }, context).sections[key]?.length, 1);
    const rejected = validateFaqSections({ [key]: [unit(`${positive.slice(0, -1)} e bloqueia clientes inadimplentes.`, [cite])] }, context);
    assert.equal(rejected.sections[key], undefined);
    assert.ok(rejected.pending.some((item) => item.includes('palavra sem fonte:')));
  }
  const plural = validateFaqSections({ resposta: [unit('Clientes recebem número.', [
    { source: 'pedido', quote: 'Cliente recebem números.' },
  ])] }, { request: { description: 'Cliente recebem números.' } });
  assert.equal(plural.sections.resposta?.length, 1);
});

test('pacote FAQ fica ready com dúvida secundária pendente e seção sem fonte omitida', async () => {
  const sha = 'a'.repeat(40);
  const citation = (line) => ({ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: line, lineEnd: line, sha });
  const sections = Object.fromEntries(['resposta', 'paraQueServe', 'quandoUsar', 'passos', 'exemplo', 'duvidas', 'erros', 'suporte'].map((key) => [key, []]));
  const direct = 'Abra Contatos no menu e clique em Adicionar Contato para cadastrar uma pessoa da sua lista.';
  const steps = [
    'Abra Contatos no menu lateral e localize Adicionar Contato antes de iniciar um novo cadastro.',
    'Clique em Adicionar Contato e preencha os campos mostrados na tela para iniciar o cadastro.',
    'Confira as informações de Adicionar Contato antes de avançar e volte à lista para localizar o cadastro.',
  ];
  sections.resposta = [unit(direct, [citation(12)])];
  sections.passos = steps.map((sentence, index) => unit(sentence, [citation(index + 13)]));
  const reply = { status: 'ready', summary: 'Página pronta.', questions: [], articles: [{
    path: 'docs/sobre-o-sistema/contatos-novos', title: 'Contatos novos', description: 'Descrição gerada pelo modelo.',
    source: 'produto', contentType: 'faq', sections, productActions: [],
    assistantQuestion: 'Como cadastrar uma pessoa?',
  }] };
  const context = { groundingRequired: true,
    matches: [{ ...citation(12), line: 12, ref: sha, excerpt: '12: Adicionar Contato' }],
    code: [{ available: true, role: 'frontend', ref: sha, repository: 'ihelpchat/front-react' }],
    screenFacts: [direct, ...steps].map((text, index) => ({ kind: 'text', text,
      property: 'translate', owner: 'ContactPage', subject: 'contato',
      source: `src/Contact.tsx:${index + 12}`, repository: 'ihelpchat/front-react', sha })),
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
  assert.match(result.articles[0].body, /## Quando falar com o suporte\n\n/u);
  assert.ok(result.pending.some((item) => item.includes('Qual formato do telefone')));
  assert.ok(result.pending.some((item) => item.includes('Erros comuns')));
});

test('plano da Agenda sai ready quando só pergunta detalhes secundários', async () => {
  const context = { groundingRequired: true,
    code: [{ available: true, repository: 'ihelpchat/front-react', ref: 'a'.repeat(40), role: 'frontend' }],
    matches: [{ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', line: 12,
      ref: 'a'.repeat(40), sha: 'a'.repeat(40), excerpt: '12: Adicionar Contato' }],
    screenFacts: [{ kind: 'action', text: 'Adicionar Contato', source: 'src/Contact.tsx:12' }],
    support: { categories: [], rules: [] }, coverage: [], pending: [],
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

test('FAQ reescreve uma vez a palavra sem fonte e bloqueia núcleo ainda descoberto', async () => {
  const sha = 'a'.repeat(40);
  const direct = 'Abra Contatos no menu e clique em Adicionar Contato para cadastrar uma pessoa da sua lista.';
  const steps = [
    'Abra Contatos no menu lateral e localize Adicionar Contato antes de iniciar um novo cadastro.',
    'Clique em Adicionar Contato e preencha os campos mostrados na tela para iniciar o cadastro.',
    'Confira as informações de Adicionar Contato antes de avançar e volte à lista para localizar o cadastro.',
  ];
  const facts = [direct, ...steps].map((text, index) => ({ kind: 'text', text,
    property: 'translate', owner: 'ContactPage', subject: 'contato',
    source: `src/Contact.tsx:${index + 12}`, repository: 'ihelpchat/front-react', sha }));
  const citation = (line) => ({ repository: facts[0].repository, path: 'src/Contact.tsx',
    lineStart: line, lineEnd: line, sha });
  const packageFor = (bad) => ({ status: 'ready', summary: 'FAQ.', questions: [], articles: [{
    path: 'docs/sobre-o-sistema/contatos-novos', title: 'Contatos novos', description: 'FAQ.',
    source: 'produto', contentType: 'faq', productActions: [], assistantQuestion: 'Como cadastrar?',
    sections: { resposta: [unit(bad ? `${direct.slice(0, -1)} e suas vendas dobram em 30 dias.` : direct, [citation(12)])],
      passos: steps.map((text, index) => unit(text, [citation(index + 13)])) },
  }] });
  const context = { groundingRequired: true, code: [{ available: true, role: 'frontend', ref: sha,
    repository: facts[0].repository }], matches: [{ ...citation(12), line: 12, ref: sha, excerpt: '12: Adicionar Contato' }],
    screenFacts: facts, support: { categories: [], rules: [] }, coverage: [], pending: [],
    businessContext: [], faqStyleExamples: [] };
  for (const corrected of [true, false]) {
    let calls = 0;
    let retryPromptSeen = false;
    const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
      { topic: 'Contatos', module: 'Contatos', description: 'Criar FAQ de contatos.' }, {
        productContext: context, plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
          calls++;
          if (calls === 2) retryPromptSeen = JSON.stringify(payload.input).includes('palavra sem fonte:');
          return { model: 'fixture', output_text: JSON.stringify(packageFor(calls === 1 || !corrected)) };
        } } },
      });
    assert.equal(calls, 2);
    assert.ok(retryPromptSeen);
    assert.equal(result.status, corrected ? 'ready' : 'needs_information');
    if (!corrected) assert.ok(result.questions.some((item) => item.includes('faltam fontes')));
  }
});
