import test from 'node:test';
import assert from 'node:assert/strict';
import { faqSubtitle, validateFreeFaqSections, judgeClaims, renderFreeFaqSections } from './faq-editorial.mjs';
import * as editorial from './faq-editorial.mjs';
import { mentionsSource } from './source-mention.mjs';
import { generateContentPackage } from './content-ai-service.mjs';
import { attachScreenshotsToArticle } from './screen-capture-manifest.mjs';
import { screenshotFile, screenshotHash } from './screenshot-files.mjs';

const definition = 'A Agenda de Contatos é a lista de clientes da empresa no iHelp.';
const navigation = 'No menu, abra **Contatos**; a tela se chama **Listar Contatos**.';
const benefit = 'A base de clientes fica na empresa, e a equipe pode consultar as informações disponíveis na ficha.';
const sections = { oQueE: [{ text: `${definition} ${navigation}` }],
  paraQueServe: [{ text: `${benefit} As tags ajudam a organizar os contatos.` }],
  passos: [{ tarefa: 'Buscar', passos: [{ text: 'No módulo **Contatos**, abra **Listar Contatos**.' }] }] };

test('description simples e independente; inválida ou repetida usa fallback sem mudar o corpo', () => {
  for (const description of ['', definition, 'Curta.', '**Texto** para consultar contatos no iHelp.', 'A'.repeat(201)]) {
    const copy = structuredClone(sections);
    assert.match(faqSubtitle(copy, { topic: 'Contatos' }, [], description), /^Como /u);
    assert.deepEqual(copy, sections);
  }
  const copy = structuredClone(sections);
  assert.equal(faqSubtitle(copy, { topic: 'Contatos' }, [], 'Consulte contatos e organize a agenda da equipe no iHelp.'),
    'Consulte contatos e organize a agenda da equipe no iHelp.');
  assert.deepEqual(copy, sections);
});

test('frase de produto aceita; atribuição destacável é removida; frase irrecuperável sai sozinha', async () => {
  assert.equal(mentionsSource(benefit), false);
  const checked = validateFreeFaqSections({ ...sections, paraQueServe: [{ text: benefit }] },
    { request: { module: 'Contatos' }, screenFacts: [] });
  assert.equal(checked.sections.paraQueServe[0].text, benefit);
  const judged = await judgeClaims({ oQueE: [{ text: 'Segundo o material enviado, o cliente aparece na lista. O cadastro fica visível.' },
    { text: 'O material usado indica um caminho sem atribuição destacável. A equipe pode consultar a ficha.' }] },
    { request: { module: 'Contatos' }, business: [{ module: 'Contatos' }] }, async (claims) => ({ claims: claims.map((claim) => ({
      id: claim.id, status: 'sustentada', reason: '', sourceMention: /material/u.test(claim.text),
    })) }));
  assert.match(renderFreeFaqSections(judged.sections), /O cliente aparece na lista\. O cadastro fica visível\./u);
  assert.match(renderFreeFaqSections(judged.sections), /A equipe pode consultar a ficha\./u);
  assert.doesNotMatch(renderFreeFaqSections(judged.sections), /O material usado/u);
  assert.match(judged.pending.join(' '), /frase omitida: mencionava a fonte/u);
});

test('fidelidade detecta perda na seção, normalizando Markdown e AConfirmar', () => {
  assert.equal(typeof editorial.faqAssemblyLosses, 'function');
  const { faqAssemblyLosses } = editorial;
  const approved = structuredClone(sections);
  const body = renderFreeFaqSections(approved);
  assert.deepEqual(faqAssemblyLosses(approved, body), []);
  const changed = body.replace(definition, '');
  assert.match(faqAssemblyLosses(approved, changed).join(' '), /perda na montagem: O que é: A Agenda/u);
  assert.deepEqual(faqAssemblyLosses({ oQueE: [{ text: '<AConfirmar>Use **Contatos**.</AConfirmar>' }] },
    '## O que é\n\nUse Contatos.'), []);
});

test('print após o passo não cria frase nem encobre perda na montagem', () => {
  const approved = { passos: [{ tarefa: 'Buscar', passos: [{ text: 'Clique em **Salvar**.' }] }] };
  const body = renderFreeFaqSections(approved);
  const bytes = Buffer.from('fixture');
  const image = screenshotFile('agenda', 'salvar', 'upload', bytes, 'png');
  const line = body.split('\n').findIndex((part) => part.includes('Clique em **Salvar**.'));
  const manifest = { entries: [{ page: 'agenda', step: 'salvar', source: 'upload', status: 'approved',
    file: image, sha256: screenshotHash(bytes), label: 'Salvar', alt: 'Clique em Salvar.', line,
    listIndex: 0, route: '/contact', owner: 'ContactsList' }] };
  const withPrint = attachScreenshotsToArticle({ path: 'docs/agenda', body }, manifest).body;
  assert.match(withPrint, /1\. Clique em \*\*Salvar\*\*\.\n\n!\[Clique em Salvar\.\]/u);
  assert.deepEqual(editorial.faqAssemblyLosses(approved, withPrint), []);
  assert.match(editorial.faqAssemblyLosses(approved,
    withPrint.replace('1. Clique em **Salvar**.', '1.')).join(' '), /perda na montagem/u);
});

test('generateContentPackage mantém as frases aprovadas do redator no artigo final', async () => {
  const sha = 'a'.repeat(40);
  const reply = { status: 'ready', summary: 'FAQ de Contatos.', questions: [], articles: [{
    path: 'docs/teste/agenda', title: 'Agenda de Contatos', description: 'Consulte contatos e organize a agenda da equipe no iHelp.',
    source: 'produto', contentType: 'faq', productActions: [], assistantQuestion: 'Como buscar contatos?',
    sections: { ...sections, paraQueServe: [{ text: `${benefit} Segundo o material enviado, os contatos aparecem na lista.` }] },
  }] };
  let writerCalls = 0;
  const result = await generateContentPackage(new URL('../', import.meta.url).pathname,
    { topic: 'Contatos', module: 'Contatos', productRoute: '/contact', description: 'Criar FAQ sobre Contatos.' }, {
      productContext: { groundingRequired: true, pending: [], coverage: [], support: { categories: [], rules: [] },
        businessContext: [{ module: 'Contatos', body: 'Contatos.' }], faqStyleExamples: [],
        screenFacts: [{ kind: 'route', route: '/contact', text: 'Contatos', source: 'src/Fixture.tsx:1', sha },
          { kind: 'action', text: 'Listar Contatos', source: 'src/Fixture.tsx:2', sha }],
        code: [{ available: true, role: 'frontend', repository: 'fixture', ref: sha }], matches: [] },
      plan: { status: 'ready' }, client: { responses: { create: async (payload) => payload.text.format.name === 'juiz_faq'
        ? { model: 'fixture', output_text: JSON.stringify({ claims: JSON.parse(payload.input[1].content).claims.map(({ id }) =>
          ({ id, status: 'sustentada', reason: '', sourceMention: false })) }) }
        : (writerCalls++, { model: 'fixture', output_text: JSON.stringify(reply) }) } },
    });
  assert.equal(result.status, 'ready', JSON.stringify(result));
  const article = result.articles[0];
  assert.equal(article.description, reply.articles[0].description);
  assert.equal(writerCalls, 1);
  assert.match(article.body, new RegExp(definition, 'u'));
  assert.match(article.body, /consultar as informações disponíveis na ficha/u);
  assert.match(article.body, /Os contatos aparecem na lista\./u);
  assert.doesNotMatch(result.pending.join(' '), /perda na montagem/u);
});
