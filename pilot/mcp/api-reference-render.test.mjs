import test from 'node:test';
import assert from 'node:assert/strict';
import * as service from './content-ai-service.mjs';
import { renderArticle } from './content-service.mjs';
const { generateContentPackage } = service;
const renderApiReference = (...args) => {
  assert.equal(typeof service.renderApiReference, 'function', 'renderApiReference deve existir');
  return service.renderApiReference(...args);
};

const endpoint = {
  verb: 'GET', route: '/api/v2/contacts/details/{IdRef}', public: true, documented: true,
  policy: 'authenticated', parameters: [{ name: 'idRef', type: 'string', in: 'route' }],
  responseFields: null,
};
const examples = [{ sections: ['Parâmetros de rota', 'Exemplo', 'Resposta', 'Campos relevantes'],
  baseUrl: 'https://apiv3.ihelpchat.com',
  components: ['Params', 'Param', 'CodeTabs', 'Response', 'Fields', 'Field'],
  languages: ['bash', 'js', 'python', 'http'] }];
const prose = { path: 'api/contatos/buscar-detalhes-do-contato', title: 'Buscar detalhes do contato',
  description: 'Consulta os detalhes de um contato identificado pelo seu código público.',
  intro: 'Consulte os detalhes do contato informado.', notas: [], grounding: [] };
const payload = { status: 'ready', summary: 'Referência de contatos.', questions: [], articles: [prose], grounding: [] };
const context = { groundingRequired: false, matches: [], code: [], endpoints: [endpoint], apiExamples: examples };
const request = { module: 'api', topic: 'Detalhes de contatos' };
async function generate(change = (value) => value, changedContext = context) {
  const output = change(structuredClone(payload));
  return generateContentPackage(process.cwd(), request, { productContext: changedContext,
    plan: { status: 'ready', guidance: 'Documente o endpoint.', questions: [] },
    client: { responses: { create: async () => ({ output_text: JSON.stringify(output), model: 'simulado' }) } } });
}

test('sem fatos estruturados não chama o provider', async () => {
  const result = await generateContentPackage(process.cwd(), request, { productContext: { ...context, endpoints: [] },
    client: { responses: { create() { throw new Error('provider não deveria ser chamado'); } } } });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), /endpoints estruturados ausentes/i);
});

test('endpoint privado não chama o provider', async () => {
  const result = await generateContentPackage(process.cwd(), request, { productContext: { ...context, endpoints: [{ ...endpoint, public: false }] },
    client: { responses: { create() { throw new Error('provider não deveria ser chamado'); } } } });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), /endpoint não público: confirmar/i);
});

test('renderizador produz rota pública, requisição concreta e pendência de resposta', async () => {
  const result = await generate();
  assert.equal(result.status, 'ready', result.questions?.join('; '));
  const [article] = result.articles;
  assert.equal(article.method, 'GET');
  assert.equal(article.endpoint, '/contacts/details/{IdRef}');
  assert.match(article.body, /curl[^\n]*\/api\/v2\/contacts\/details\/abc123/);
  assert.match(article.body, /<Param name="idRef" type="string" required>/);
  assert.match(article.body, /Campos de resposta ainda não documentados/);
  assert.doesNotMatch(article.body, /<Field\b/);
  assert.ok(result.pending.some((item) => /campos de resposta não verificáveis/i.test(item)));
  assert.match(renderArticle(article), /method: GET/);
});

for (const [name, change, reason] of [
  ['método na prosa', (value) => { value.articles[0].intro = 'Use o método POST para consultar os contatos.'; return value; }, /POST/],
  ['rota na prosa', (value) => { value.articles[0].intro = 'Consulte em /api/v9/contacts.'; return value; }, /\/api\/v9\/contacts/],
  ['campo codigo da IA', (value) => { value.articles[0].codigo = 'inventado'; return value; }, /codigo/],
  ['campo resposta da IA', (value) => { value.articles[0].resposta = '<Field name="segredoInterno">'; return value; }, /resposta/],
  ['endpoint da IA', (value) => { value.articles[0].endpoint = '/contacts/fake'; return value; }, /endpoint/],
  ['JSX na prosa', (value) => { value.articles[0].intro = '<Field name="segredoInterno">'; return value; }, /Field/],
  ['bloco de código', (value) => { value.articles[0].intro = '```js\nconst x = 1\n```'; return value; }, /```js/],
  ['código inline não factual', (value) => { value.articles[0].intro = 'Use `segredoInterno`.'; return value; }, /segredoInterno/],
  ['método no summary', (value) => { value.summary = 'Use o método POST.'; return value; }, /POST/],
]) test(`provider rejeita ${name} com trecho do motivo`, async () => {
  const result = await generate(change);
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), reason);
  assert.deepEqual(result.articles, []);
});

test('nome exato de parâmetro em código inline é aceito', async () => {
  const result = await generate((value) => { value.articles[0].intro = 'Informe `idRef` para localizar o contato.'; return value; });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
});

for (const [label, field, proseValue, expected] of [
  ['campo inventado na description', 'description', 'O campo segredoInterno retorna a chave privada.', /segredoInterno/],
  ['parâmetro inventado no intro', 'intro', 'O parâmetro tokenMestre é obrigatório para consultar.', /tokenMestre/],
  ['nomes comuns inventados após campos', 'intro', 'Informe os campos nome e telefone.', /nome|telefone/],
  ['identificador inventado no title', 'title', 'Consultar segredo_interno', /segredo_interno/],
  ['identificador inventado nas notas', 'notas', ['Informe token-v2 para consultar.'], /token-v2/],
  ['identificador com dígito no começo', 'intro', 'Informe 2fa antes da consulta.', /2fa/],
  ['identificador com dígito no meio', 'intro', 'Informe chave2Interna antes da consulta.', /chave2Interna/],
]) test(`prosa rejeita ${label}`, async () => {
  const result = await generate((value) => { value.articles[0][field] = proseValue; return value; });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), expected);
  assert.deepEqual(result.articles, []);
});

test('nomes comuns de campos conhecidos são aceitos na prosa', async () => {
  const facts = { ...endpoint, responseFields: [{ name: 'nome', type: 'string' }, { name: 'telefone', type: 'string' }] };
  const result = await generate((value) => { value.articles[0].intro = 'Informe os campos nome e telefone.'; return value; },
    { ...context, endpoints: [facts] });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
});

test('descrição comum sem nome técnico é aceita', async () => {
  const result = await generate((value) => { value.articles[0].description = 'Retorna os dados do contato para consulta na plataforma.'; return value; });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
});

test('nome de rota citado na prosa é aceito', async () => {
  const result = await generate((value) => { value.articles[0].intro = 'O parâmetro IdRef identifica o contato.'; return value; });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
});

test('somente responseFields entram em Fields', () => {
  const withResponse = { ...endpoint, responseFields: [{ name: 'nome', type: 'string' }] };
  const rendered = renderApiReference(withResponse, examples);
  assert.match(rendered.body, /<Field name="nome">/);
  assert.doesNotMatch(rendered.body, /segredoInterno/);
});

test('alias de placeholder já publicado preserva endpoint e Param da página', () => {
  const fact = { ...endpoint, route: '/api/v2/contactTags/getContactsTagByContactId/{contactId}',
    parameters: [{ name: 'contactId', type: 'int', in: 'route' }] };
  const page = { ...examples[0], frontmatter: { endpoint: '/contactTags/getContactsTagByContactId/{id}' } };
  const rendered = renderApiReference(fact, [page], page);
  assert.equal(rendered.endpoint, '/contactTags/getContactsTagByContactId/{id}');
  assert.match(rendered.body, /<Param name="id" type="number" required>/);
  assert.match(rendered.body, /\/api\/v2\/contactTags\/getContactsTagByContactId\/1/);
});

test('rota opcional preserva a página pública sem o segmento opcional', async () => {
  const fact = { ...endpoint, route: '/api/v2/contacts/{letter}', optionalAlias: '/api/v2/contacts',
    parameters: [{ name: 'letter', type: 'string', in: 'route' }, { name: 'page', type: 'int', in: 'query' }] };
  const page = { ...examples[0], path: prose.path, paramNames: ['page'],
    frontmatter: { source: 'api', contentType: 'referencia', method: 'GET', endpoint: '/contacts' } };
  const result = await generate((value) => value, { ...context, endpoints: [fact], apiExamples: [page] });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
  assert.equal(result.articles[0].endpoint, '/contacts');
  assert.match(result.articles[0].body, /\/api\/v2\/contacts\?page=1/);
  assert.doesNotMatch(result.articles[0].body, /<Param name="letter"/);
});

test('query e body usam nomes e valores tipados dos fatos', () => {
  const fact = { ...endpoint, verb: 'POST', route: '/api/v2/contacts',
    parameters: [{ name: 'page', type: 'int', in: 'query' }, { name: 'name', type: 'string', in: 'body' }] };
  const rendered = renderApiReference(fact, examples);
  assert.match(rendered.body, /<Param name="page" type="number">query/);
  assert.match(rendered.body, /<Param name="name" type="string" required>body/);
  assert.match(rendered.body, /\/api\/v2\/contacts\?page=1/);
  assert.match(rendered.body, /-d '\{"name":"abc123"\}'/);
});

test('seções técnicas seguem a ordem lida da página', () => {
  const style = [{ ...examples[0], sections: ['Exemplo', 'Parâmetros de rota', 'Resposta'] }];
  const body = renderApiReference(endpoint, style).body;
  assert.ok(body.indexOf('## Exemplo') < body.indexOf('## Parâmetros de rota'));
});

test('renderizador é determinístico byte a byte', () => {
  assert.equal(JSON.stringify(renderApiReference(endpoint, examples)), JSON.stringify(renderApiReference(endpoint, examples)));
});
