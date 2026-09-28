import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFaqQuestions, selectFaqStyleExamples, loadBusinessContext,
  adaptScreenFacts, validateFaqSections, faqSubtitle, replaceModuleTerminology,
  deterministicFaqAnswer, fixedFaqSupportSection, renderFreeFaqSections } from './faq-editorial.mjs';
import { generateContentPackage, planContent } from './content-ai-service.mjs';
import { FAQ_NEUTRAL_WORDS } from './faq-neutral-words.mjs';

const unit = (text, citations) => ({ text, citations });
const distinctActions = ['Adicionar Contato', 'Abrir Cadastro de Contato', 'Selecionar Departamento do Contato',
  'Escolher Atendente Responsável', 'Conferir Dados do Contato', 'Salvar Novo Contato',
  'Voltar à Lista de Contatos', 'Localizar Contato Cadastrado'];

test('subtítulo sustentado também permanece em O que é; pendência usa fallback fixo', () => {
  const request = { topic: 'Robô', module: 'Robôs', description: 'Criar, editar e publicar robôs.' };
  const facts = [{ kind: 'route', text: 'Robôs', route: '/bot' },
    ...['Criar robô', 'Editar robô', 'Publicar'].map((text, line) => ({ kind: 'action', text,
      repository: 'fixture', path: 'fixture', sha: 'a', lineStart: line, lineEnd: line }))];
  const supported = { oQueE: [{ text: 'Os robôs orientam o atendimento. Eles têm um fluxo configurável.' }] };
  assert.equal(faqSubtitle(supported, request, facts), 'Os robôs orientam o atendimento.');
  assert.equal(supported.oQueE[0].text, 'Os robôs orientam o atendimento. Eles têm um fluxo configurável.');
  assert.match(renderFreeFaqSections(supported), /## O que é\n\nOs robôs orientam o atendimento/u);
  const pending = { oQueE: [{ text: '<AConfirmar>Os robôs orientam o atendimento.</AConfirmar>' }] };
  assert.equal(faqSubtitle(pending, request, facts), 'Como criar, editar e publicar robôs de atendimento no iHelp.');
  assert.match(pending.oQueE[0].text, /AConfirmar/u);
  assert.match(deterministicFaqAnswer(request, facts)?.text ?? '', /^No módulo \*\*Robôs\*\*/u);
  assert.match(fixedFaqSupportSection(request, facts)[0].text, /no módulo Robôs/u);
});

test('nome do módulo muda só a referência ao item do menu', () => {
  assert.equal(replaceModuleTerminology('Abra a tela **Contatos**. Depois abra a tela **Importar Contatos**.', 'Contatos'),
    'Abra o módulo **Contatos**. Depois abra a tela **Importar Contatos**.');
  assert.equal(replaceModuleTerminology('Na tela **Contatos**, busque uma pessoa.', 'Contatos'),
    'No módulo **Contatos**, busque uma pessoa.');
});
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
    duvidas: [unit('Importação e validação do resultado.', [{ source: 'suporte', quote: 'Cobrir importação e validação do resultado.' }])],
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

test('quote de suporte exige trecho literal, com a frase e a fonte mantidas', () => {
  const text = 'Clientes recebem números válidos.';
  const context = { support: { categories: [{ category: 'Contatos', guidance: text }] } };
  const check = (quote) => validateFaqSections({ duvidas: [unit(text, [
    { source: 'suporte', quote },
  ])] }, context);
  assert.equal(check(text).sections.duvidas?.length, 1);
  const changedQuote = check('Cliente recebem números válidos.');
  assert.equal(changedQuote.sections.duvidas, undefined);
  assert.ok(changedQuote.pending.includes('seção sem fonte válida: Dúvidas comuns'));
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

test('contexto privado configurado chega ao prompt e pode ser citado', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faq-pilot-'));
  const oldBusinessDir = process.env.BUSINESS_CONTEXT_DIR;
  try {
    await mkdir(join(root, 'architecture', 'business-context'), { recursive: true });
    process.env.BUSINESS_CONTEXT_DIR = join(root, 'architecture', 'business-context');
    await writeFile(join(root, 'architecture', 'business-context', 'contatos.md'),
      '🟢 PÚBLICO\nOrganizar contatos evita retrabalho da equipe.');
    await writeFile(join(root, 'architecture', 'business-context', 'robos.md'),
      '🟢 PÚBLICO\nO robô orienta o primeiro contato.');
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
    assert.doesNotMatch(prompt, /O robô orienta o primeiro contato/u);
    assert.equal(validateFaqSections({ paraQueServe: [unit('Organizar contatos evita retrabalho.', [
      { source: 'negocio', path: 'business-context/contatos.md', quote: 'Organizar contatos evita retrabalho da equipe.' },
    ])] }, { business: context.businessContext }).sections.paraQueServe?.length, 1);
  } finally {
    if (oldBusinessDir === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = oldBusinessDir;
    await rm(root, { recursive: true, force: true });
  }
});

test('SHA do front com dez dígitos consecutivos chega íntegro ao prompt e ao passo', async () => {
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
    const step = validateFaqSections({ passos: [{ acao: 'clicar', fato: 'f1' }] },
      { screenFacts: adaptScreenFacts({ facts: [fact], sha }) });
    assert.equal(step.sections.passos?.length, 1);
    assert.equal(step.sections.passos[0].citations[0].sha, sha);
  }
});

test('id de fato inválido é recusado mesmo com fonte vizinha', () => {
  const facts = adaptScreenFacts({ sha: 'a'.repeat(40), facts: [{ kind: 'action', text: 'Criar novo robô',
    source: 'src/Fixture.tsx:12' }] });
  assert.equal(validateFaqSections({ passos: [{ acao: 'clicar', fato: 'f1' }] },
    { screenFacts: facts }).sections.passos?.length, 1);
  assert.equal(validateFaqSections({ passos: [{ acao: 'clicar', fato: 'f2' }] },
    { screenFacts: facts }).sections.passos, undefined);
});

test('passos e erros rejeitam texto livre com ação inventada', () => {
  const facts = adaptScreenFacts({ sha: 'a'.repeat(40), facts: [
    { kind: 'action', text: 'Criar novo robô', source: 'src/Robot.tsx:12' },
    { kind: 'validation', text: 'O nome é obrigatório', source: 'src/Robot.tsx:13' },
  ] });
  const step = { acao: 'clicar', fato: 'f1' };
  assert.equal(validateFaqSections({ passos: [step] }, { screenFacts: facts }).sections.passos?.length, 1);
  assert.equal(validateFaqSections({ passos: [{ ...step, text: 'Apague tudo.' }] },
    { screenFacts: facts }).sections.passos, undefined);
  assert.equal(validateFaqSections({ erros: [{ mensagem: 'f2', text: 'Destrua sua conta.' }] },
    { screenFacts: facts }).sections.erros, undefined);
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
  assert.equal(check('Cadastrar os contatos pela tela Contatos.').sections.paraQueServe?.length, 1);
  assert.equal(check('Cadastrar os contatos pela tela AgendaNova.').sections.paraQueServe, undefined);
  assert.equal(check('Cadastrar contatos para organizar equipes modernas e campanhas futuras.').sections.paraQueServe, undefined);
  assert.equal(check('Campanhas reduzem custos e ampliam receitas pela tela Contatos.').sections.paraQueServe, undefined);
});

test('negócio começa vazio e fatos da tela mantêm proveniência', async () => {
  const root = await mkdtemp(join(tmpdir(), 'faq-business-'));
  const oldBusinessDir = process.env.BUSINESS_CONTEXT_DIR;
  try {
    await mkdir(join(root, 'architecture', 'business-context'), { recursive: true });
    process.env.BUSINESS_CONTEXT_DIR = join(root, 'architecture', 'business-context');
    await writeFile(join(root, 'architecture', 'business-context', 'README.md'), 'Formato público');
    assert.deepEqual(await loadBusinessContext(root), []);
    await writeFile(join(root, 'architecture', 'business-context', 'publico.md'), '🟢 PÚBLICO\nA equipe ganha tempo.');
    await writeFile(join(root, 'architecture', 'business-context', 'interno.md'), '🟡 INTERNO\nNão publicar.');
    assert.equal((await loadBusinessContext(root)).length, 1);
    const facts = adaptScreenFacts({ facts: [{ kind: 'action', text: 'Adicionar Contato', source: 'src/Contact.tsx:12', subject: 'cadastro contato' }], sha: 'a'.repeat(40) });
    assert.equal(facts[0].lineStart, 12);
    assert.equal(facts[0].text, 'Adicionar Contato');
  } finally {
    if (oldBusinessDir === undefined) delete process.env.BUSINESS_CONTEXT_DIR;
    else process.env.BUSINESS_CONTEXT_DIR = oldBusinessDir;
    await rm(root, { recursive: true, force: true });
  }
});

test('passo exige id de fato e erro exige mensagem validada', () => {
  const facts = adaptScreenFacts({ sha: 'a'.repeat(40), facts: [
    { kind: 'action', text: 'Adicionar Contato', source: 'src/Contact.tsx:12' },
    { kind: 'validation', text: 'Nome obrigatório', source: 'src/Contact.tsx:13' },
    { kind: 'field', name: 'name', text: 'Nome', required: true, source: 'src/Contact.tsx:14',
      validationSource: 'src/ContactSchema.ts:7' },
  ] });
  const good = validateFaqSections({ passos: [{ acao: 'clicar', fato: 'f1' }],
    erros: [{ mensagem: 'f2', corrigir: { acao: 'preencher', fato: 'f3' } }] }, { screenFacts: facts });
  assert.equal(good.sections.passos?.length, 1);
  assert.match(good.sections.erros?.[0].text ?? '', /Nome obrigatório.*Nome.*obrigatório/u);
  assert.equal(validateFaqSections({ erros: [{ mensagem: 'f1' }] }, { screenFacts: facts }).sections.erros, undefined);
});

test('required real de M5.58 governa a frase gerada e dúvidas', () => {
  const sha = 'a'.repeat(40);
  const supportQuote = 'Nome obrigatório. Nome opcional.';
  for (const required of [true, false, 'unknown']) {
    const facts = adaptScreenFacts({ sha, facts: [{ kind: 'field', text: 'Nome', required,
      source: 'src/Contact.tsx:12' }] });
    const context = { screenFacts: facts, support: { categories: [{ category: 'Contatos', guidance: supportQuote }] } };
    const step = validateFaqSections({ passos: [{ acao: 'preencher', fato: 'f1' }] }, context);
    assert.equal(step.sections.passos?.length, 1);
    assert.equal(step.sections.passos[0].text.includes('(obrigatório)'), required === true);
    for (const [word, permitted] of [['obrigatório', required === true], ['opcional', required === false]]) {
      const sentence = `**Nome** ${word}.`;
      const result = validateFaqSections({ duvidas: [unit(sentence,
        [{ source: 'suporte', quote: supportQuote }])] }, context);
      assert.equal(Boolean(result.sections.duvidas), permitted);
    }
  }
});

test('obrigatoriedade vinda do schema cita a linha do schema', () => {
  const facts = adaptScreenFacts({ sha: 'a'.repeat(40), facts: [{ kind: 'field', text: 'Nome',
    required: true, source: 'src/Contact.tsx:12', validationSource: 'src/ContactSchema.ts:7' }] });
  const rendered = validateFaqSections({ passos: [{ acao: 'preencher', fato: 'f1' }] }, { screenFacts: facts });
  assert.match(rendered.sections.passos?.[0].text ?? '', /Nome.*obrigatório/u);
  assert.ok(rendered.sections.passos[0].citations.some((cite) => cite.path === 'src/ContactSchema.ts' && cite.lineStart === 7));
});

test('resposta livre tem cobertura integral; passo não recebe texto de promessa', () => {
  const fact = { repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: 12,
    lineEnd: 12, sha: 'a'.repeat(40), kind: 'action', text: 'Adicionar Contato' };
  const citation = { repository: fact.repository, path: fact.path, lineStart: 12, lineEnd: 12, sha: fact.sha };
  const context = { screenFacts: [fact] };
  const sentence = 'Clique em **Adicionar Contato**.';
  assert.equal(validateFaqSections({ resposta: [unit(sentence, [citation])],
    passos: [{ acao: 'clicar', fato: 'f1' }] }, context).sections.passos?.length, 1);
  const rejected = validateFaqSections({ resposta: [unit('Clique em **Adicionar Contato** e suas vendas dobram em 30 dias.', [citation])],
    passos: [{ acao: 'clicar', fato: 'f1', text: 'Vendas dobram em 30 dias.' }] }, context);
  assert.equal(rejected.sections.resposta, undefined);
  assert.equal(rejected.sections.passos, undefined);
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

test('dúvidas rejeitam palavra sem fonte; erro usa só mensagem estruturada', () => {
  assert.ok(FAQ_NEUTRAL_WORDS.length >= 190);
  const fact = { kind: 'validation', text: 'Número obrigatório', repository: 'ihelpchat/front-react',
    path: 'src/Contact.tsx', lineStart: 12, lineEnd: 12, sha: 'a'.repeat(40) };
  const context = { screenFacts: [fact], support: { categories: [{ category: 'Contatos',
    guidance: 'Clientes não recebem números inválidos.' }] } };
  const cited = { source: 'suporte', quote: 'Clientes não recebem números inválidos.' };
  assert.equal(validateFaqSections({ duvidas: [unit('Clientes não recebem números inválidos.', [cited])] }, context).sections.duvidas?.length, 1);
  const rejected = validateFaqSections({ duvidas: [unit('Clientes não recebem números inválidos e bloqueiam inadimplentes.', [cited])] }, context);
  assert.equal(rejected.sections.duvidas, undefined);
  assert.ok(rejected.pending.some((item) => item.includes('palavra sem fonte:')));
  assert.equal(validateFaqSections({ erros: [{ mensagem: 'f1' }] }, context).sections.erros?.length, 1);
  assert.equal(validateFaqSections({ erros: [{ mensagem: 'f1', text: 'Bloqueie clientes.' }] }, context).sections.erros, undefined);
  const plural = validateFaqSections({ resposta: [unit('Clientes recebem número.', [
    { source: 'pedido', quote: 'Cliente recebem números.' },
  ])] }, { request: { description: 'Cliente recebem números.' } });
  assert.equal(plural.sections.resposta?.length, 1);
});

test('pacote FAQ livre fica ready com dúvida secundária pendente', async () => {
  const sha = 'a'.repeat(40);
  const citation = (line) => ({ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx', lineStart: line, lineEnd: line, sha });
  const sections = Object.fromEntries(['oQueE', 'paraQueServe', 'casosDeUso', 'passos', 'duvidas', 'erros', 'suporte'].map((key) => [key, []]));
  const direct = 'Abra Contatos no menu e clique em Adicionar Contato para cadastrar uma pessoa da sua lista.';
  const steps = distinctActions;
  sections.oQueE = [{ text: 'A tela Contatos organiza as pessoas da sua lista.' }];
  sections.passos = [{ tarefa: 'Cadastrar', passos: [
    { text: '### Cadastrar' },
    { text: 'Clique em **Adicionar Contato**.' },
    ...steps.map((text) => ({ text: `Clique em **${text}**.` })),
  ] }];
  const reply = { status: 'ready', summary: 'Página pronta.', questions: [], articles: [{
    path: 'docs/sobre-o-sistema/contatos-novos', title: 'Contatos novos', description: 'Descrição gerada pelo modelo.',
    source: 'produto', contentType: 'faq', sections, productActions: [],
    assistantQuestion: 'Como cadastrar uma pessoa?',
  }] };
  const context = { groundingRequired: true,
    matches: [{ ...citation(12), line: 12, ref: sha, excerpt: '12: Adicionar Contato' }],
    code: [{ available: true, role: 'frontend', ref: sha, repository: 'ihelpchat/front-react' }],
    screenFacts: [{ kind: 'route', text: 'Contatos', source: 'src/Contact.tsx:11', sha }, ...[direct, ...steps].map((text, index) => ({ kind: 'action', text: index ? text : 'Adicionar Contato',
      property: 'translate', owner: 'ContactPage', subject: 'contato',
      source: `src/Contact.tsx:${index + 12}`, repository: 'ihelpchat/front-react', sha }))],
    support: { categories: [], rules: [] }, coverage: [], pending: [], businessContext: [], faqStyleExamples: [] };
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
    { topic: 'Contatos', module: 'Contatos', description: 'Criar FAQ para cadastrar contatos.' },
    { productContext: context, plan: { status: 'ready', pending: ['pergunta pendente: Qual formato do telefone?'] },
      client: { responses: { create: async (payload) => {
        if (payload.text.format.name === 'juiz_faq') {
          const claims = JSON.parse(payload.input[1].content).claims;
          return { model: 'fixture', output_text: JSON.stringify({ claims: claims.map(({ id }) =>
            ({ id, status: 'sustentada', reason: '' })) }) };
        }
        assert.ok(payload.text.format.schema.properties.articles.items.properties.sections);
        assert.ok(!payload.text.format.schema.properties.articles.items.properties.body);
        const schema = payload.text.format.schema.properties.articles.items.properties.sections.properties;
        assert.equal(schema.passos.items.properties.passos.items.properties.text.type, 'string');
        assert.equal(schema.passos.items.properties.fato, undefined);
        return { model: 'fixture', output_text: JSON.stringify(reply) };
      } } } });
  assert.equal(result.status, 'ready', JSON.stringify(result.questions));
  assert.match(result.articles[0].description, /^Como cadastrar contatos no iHelp/u);
  assert.doesNotMatch(result.articles[0].body, /^Na tela/u);
  assert.doesNotMatch(result.articles[0].body, /1\. ### Cadastrar/u);
  assert.doesNotMatch(result.articles[0].body, /Erros comuns/u);
  assert.match(result.articles[0].body, /## Quando falar com o suporte\n\n/u);
  assert.ok(result.pending.some((item) => item.includes('Qual formato do telefone')));
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

test('FAQ ignora resposta direta livre do modelo', async () => {
  const sha = 'a'.repeat(40);
  const direct = 'Abra Contatos no menu e clique em Adicionar Contato para cadastrar uma pessoa da sua lista.';
  const steps = distinctActions;
  const facts = [{ kind: 'route', text: 'Contatos', source: 'src/Contact.tsx:11', sha }, ...[direct, ...steps].map((text, index) => ({ kind: 'action', text: index ? text : 'Adicionar Contato',
    property: 'translate', owner: 'ContactPage', subject: 'contato',
    source: `src/Contact.tsx:${index + 12}`, repository: 'ihelpchat/front-react', sha }))];
  const citation = (line) => ({ repository: 'ihelpchat/front-react', path: 'src/Contact.tsx',
    lineStart: line, lineEnd: line, sha });
  const packageFor = (bad) => ({ status: 'ready', summary: 'FAQ.', questions: [], articles: [{
    path: 'docs/sobre-o-sistema/contatos-novos', title: 'Contatos novos', description: 'FAQ.',
    source: 'produto', contentType: 'faq', productActions: [], assistantQuestion: 'Como cadastrar?',
    sections: { resposta: [unit(bad ? `${direct.slice(0, -1)} e suas vendas dobram em 30 dias.` : direct, [citation(12)])],
      passos: steps.map((_, index) => ({ acao: 'clicar', fato: `f${index + 3}` })) },
  }] });
  const context = { groundingRequired: true, code: [{ available: true, role: 'frontend', ref: sha,
    repository: 'ihelpchat/front-react' }], matches: [{ ...citation(12), line: 12, ref: sha, excerpt: '12: Adicionar Contato' }],
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
    assert.ok(calls >= 1 && calls <= 2);
    assert.equal(result.status, 'ready', JSON.stringify(result.questions));
    assert.doesNotMatch(result.articles[0].body, /vendas dobram/u);
  }
});
