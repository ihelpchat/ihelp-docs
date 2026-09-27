import test from 'node:test';
import assert from 'node:assert/strict';
import { generateContentPackage } from './content-ai-service.mjs';

const quote = 'A busca aceita filtros por nome do contato';
const request = { topic: 'API de contatos', module: 'api', description: 'Referência para consultar contatos', details: `Resposta do time: ${quote}.` };
const match = { repository: 'ihelpchat/olah-ihelp', path: 'Controllers/ContactsController.cs', sha: 'a'.repeat(40), ref: 'a'.repeat(40), line: 12 };
const code = { repository: match.repository, path: match.path, sha: match.sha, lineStart: match.line, lineEnd: match.line };
const pedido = { source: 'pedido', quote };
const prose = { path: 'api/contatos/buscar', endpoint: 'GET /contacts', title: 'Buscar contatos',
  description: 'A busca aceita filtros por nome do contato.', intro: 'Consulte os contatos usando os filtros informados.', notas: [], grounding: [] };
const output = { status: 'ready', summary: 'Referência para buscar contatos.', questions: [], articles: [prose], grounding: [] };
const context = { groundingRequired: true, code: [{ available: true }], matches: [match], endpoints: [{ verb: 'GET', route: '/api/v2/contacts', public: true, documented: true, policy: 'authenticated', parameters: [], responseFields: null }],
  apiExamples: [{ sections: ['Parâmetros', 'Resposta'], baseUrl: 'https://apiv3.ihelpchat.com', components: ['Params', 'Param'], languages: ['bash'] }] };
function grounded(value, citation) {
  return value.split(/(?<=[.!?])\s+|\n/u).map((text) => ({ text: text.trim(), citations: [citation] }));
}
function fixture() {
  const value = structuredClone(output);
  value.grounding = grounded(value.summary, code);
  value.articles[0].grounding = [
    ...grounded(value.articles[0].description, pedido),
    ...grounded(value.articles[0].intro, code),
  ];
  return value;
}
async function generate(change = (value) => value, changedRequest = request, module = 'api') {
  const value = change(fixture());
  return generateContentPackage(process.cwd(), { ...changedRequest, module }, { productContext: module === 'api' ? context : { ...context, request: changedRequest }, plan: { status: 'ready' },
    client: { responses: { create: async (payload) => {
      if (module === 'api') {
        assert.match(payload.input[0].content, /pedido/i);
        assert.match(JSON.stringify(payload.text.format.schema), /"source"/);
      }
      return { output_text: JSON.stringify(value), model: 'simulado' };
    } } } });
}

test('API aceita trecho literal do pedido junto com citação de código', async () => {
  const result = await generate();
  assert.equal(result.status, 'ready', result.questions?.join('; '));
});

test('API aceita quote da description após normalizar espaços', async () => {
  const description = 'A consulta lista contatos em ordem crescente';
  const result = await generate((value) => {
    value.grounding = [{ text: value.summary, citations: [{ source: 'pedido', quote: 'A consulta lista\ncontatos em ordem crescente' }] }];
    return value;
  }, { ...request, description: `Referência. ${description}.` });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
});

test('API aceita código e pedido na mesma frase', async () => {
  const result = await generate((value) => {
    value.articles[0].grounding[0].citations.push(code);
    return value;
  });
  assert.equal(result.status, 'ready', result.questions?.join('; '));
});

for (const [name, change] of [
  ['quote ausente do pedido', (value) => { value.articles[0].grounding[0].citations[0].quote = 'A busca aceita filtros por telefone'; }],
  ['quote menor que 12 caracteres', (value) => { value.articles[0].grounding[0].citations[0].quote = 'contato'; }],
  ['frase sem citação', (value) => { value.articles[0].grounding[0].citations = []; }],
]) test(`API rejeita ${name} com motivo`, async () => {
  const result = await generate((value) => { change(value); return value; });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /não está vinculada às linhas do código recuperado/i);
});

test('API rejeita nome técnico do pedido sem fato de código', async () => {
  const details = `${request.details} O campo segredo representa um valor reservado.`;
  const result = await generate((value) => {
    value.articles[0].description = 'O campo segredo representa um valor reservado.';
    value.articles[0].grounding[0] = { text: value.articles[0].description, citations: [{ source: 'pedido', quote: 'O campo segredo representa um valor reservado.' }] };
    return value;
  }, { ...request, details });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), /nome técnico sem fato: segredo/i);
});

test('guia rejeita citação do pedido com motivo', async () => {
  const result = await generate((value) => {
    value.articles = [{ path: 'docs/contatos/guia', title: 'Guia', description: prose.description, body: prose.intro,
      source: 'produto', contentType: 'guia', productActions: [], assistantQuestion: 'Como buscar?', assistantOverview: prose.intro,
      assistantInitialSteps: 1, assistantSuggestions: [prose.intro], grounding: [
        ...grounded(prose.description, pedido), ...grounded(prose.intro, code),
      ] }];
    return value;
  }, request, 'Contatos');
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /não está vinculada às linhas do código recuperado/i);
});
