import test from 'node:test';
import assert from 'node:assert/strict';
import * as service from './content-ai-service.mjs';
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
});

for (const [name, change, reason] of [
  ['método na prosa', (value) => { value.articles[0].intro = 'Use o método POST para consultar os contatos.'; return value; }, /POST/],
  ['rota na prosa', (value) => { value.articles[0].intro = 'Consulte em /api/v9/contacts.'; return value; }, /\/api\/v9\/contacts/],
  ['campo codigo da IA', (value) => { value.articles[0].codigo = 'inventado'; return value; }, /codigo/],
  ['campo resposta da IA', (value) => { value.articles[0].resposta = '<Field name="segredoInterno">'; return value; }, /resposta/],
  ['endpoint da IA', (value) => { value.articles[0].endpoint = '/contacts/fake'; return value; }, /endpoint/],
]) test(`provider rejeita ${name} com trecho do motivo`, async () => {
  const result = await generate(change);
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), reason);
  assert.deepEqual(result.articles, []);
});

test('somente responseFields entram em Fields', () => {
  const withResponse = { ...endpoint, responseFields: [{ name: 'nome', type: 'string' }] };
  const rendered = renderApiReference(withResponse, examples);
  assert.match(rendered.body, /<Field name="nome">/);
  assert.doesNotMatch(rendered.body, /segredoInterno/);
});

test('renderizador é determinístico byte a byte', () => {
  assert.equal(JSON.stringify(renderApiReference(endpoint, examples)), JSON.stringify(renderApiReference(endpoint, examples)));
});
