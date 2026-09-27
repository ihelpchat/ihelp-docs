import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateContentPackage } from './content-ai-service.mjs';
import { renderApiReference } from './api-reference-render.mjs';
import { securityReview } from './security-review.mjs';

// Minimal checked-in slice of the actual offline resp-2 model response (m557e).
const source = JSON.parse(await readFile(new URL('./fixtures/m557-resp2-replay.json', import.meta.url)));
const description = source.list.responseDescription.description.text;
const list = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  authorization: 'authenticated', parameters: [], responseFields: [{ name: 'id', type: 'int' }],
  responseEnvelope: 'dados', responseList: true };
const tags = { verb: 'GET', route: '/api/v2/contactTags/getContactsTagByContactId/{contactId}',
  public: true, documented: true, authorization: 'authenticated',
  parameters: [{ name: 'contactId', type: 'int', in: 'route' }], responseFields: [] };
const unit = (text) => ({ text, citations: [] });
const article = (path, endpoint, responseDescriptions = []) => ({ path, endpoint, title: 'Contatos',
  description: unit('Consulta os contatos disponíveis na referência pública da API.'),
  intro: unit('Use para consultar contatos.'), notas: [], responseDescriptions });
const packageOutput = { status: 'ready', summary: [unit('Contatos.')], questions: [], articles: [
  article(source.list.path, 'GET /contacts', [{ name: 'dados[].id', description: unit(description) }]),
  article(source.tags.path, source.tags.endpoint),
] };
async function replay(mutate = () => {}, endpoints = [list, tags]) {
  const output = structuredClone(packageOutput);
  mutate(output);
  if (endpoints.length === 1) output.articles.pop();
  return generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos' }, {
    productContext: { groundingRequired: false, matches: [], code: [], endpoints,
      apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param', 'Fields', 'Field'] }] },
    plan: { status: 'ready' },
    client: { responses: { create: async () => ({ output_text: JSON.stringify(output), model: 'replay-offline' }) } },
  });
}

test('resp-2 aceita contactId de outro endpoint selecionado do pacote', async () => {
  const result = await replay();
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.articles[0].body, /usado como contactId na consulta de tags/u);
});

test('nome público WhatsApp é aceito na descrição de campo', async () => {
  const result = await replay((value) => { value.articles[0].responseDescriptions[0].description.text =
    'Campo textual de WhatsApp.'; });
  assert.equal(result.status, 'ready', result.summary);
});

test('idRef na prosa corresponde ao segmento {IdRef} sem diferenciar maiúsculas', async () => {
  const detail = { verb: 'GET', route: '/api/v2/contacts/details/{IdRef}', public: true, documented: true,
    authorization: 'authenticated', parameters: [{ name: 'IdRef', type: 'string', in: 'route' }], responseFields: [] };
  const result = await replay((value) => {
    value.summary = [unit('Use idRef para consultar detalhes.')];
    value.articles[0] = article('api/contatos/detalhes', 'GET /contacts/details/{IdRef}');
    value.articles[0].intro.text = 'Use idRef para consultar o contato.';
  }, [detail]);
  assert.equal(result.status, 'ready', result.summary);
});

test('idRefx com uma letra inventada continua recusado', async () => {
  const detail = { verb: 'GET', route: '/api/v2/contacts/details/{IdRef}', public: true, documented: true,
    authorization: 'authenticated', parameters: [{ name: 'IdRef', type: 'string', in: 'route' }], responseFields: [] };
  const result = await replay((value) => {
    value.summary = [unit('Use idRefx para consultar detalhes.')];
    value.articles[0] = article('api/contatos/detalhes', 'GET /contacts/details/{IdRef}');
    value.articles[0].intro.text = 'Use idRefx para consultar o contato.';
  }, [detail]);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /nome técnico sem fato: idRefx/u);
});

test('uma letra inventada em WhatsAppz mantém recusa por nome técnico sem fato', async () => {
  const result = await replay((value) => { value.articles[0].responseDescriptions[0].description.text =
    'Campo textual de WhatsAppz.'; });
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /nome técnico sem fato: WhatsAppz/u);
});

test('resp-2 com um único nome inventado recusa por falta de fato', async () => {
  const result = await replay((value) => { value.articles[0].responseDescriptions[0].description.text =
    description.replace('contactId', 'contatoIdInventado'); });
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /nome técnico sem fato: contatoIdInventado/u);
});

test('resp-2 sem endpoint de tags recusa contactId', async () => {
  const result = await replay(() => {}, [list]);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /nome técnico sem fato: contactId/u);
});

test('rótulo tipado aceita parâmetro de outra página, mas não chama campo de parâmetro', async () => {
  const positive = await replay((value) => { value.articles[0].responseDescriptions[0].description.text =
    'Identificador numérico do contato, usado como parâmetro contactId na consulta de tags.'; });
  assert.equal(positive.status, 'ready', positive.summary);
  const negative = await replay((value) => { value.articles[0].responseDescriptions[0].description.text =
    'Identificador numérico do contato, usado como parâmetro id na consulta de tags.'; });
  assert.equal(negative.status, 'needs_information');
  assert.match(negative.summary, /nome técnico sem fato: id/u);
  const wrongKind = await replay((value) => { value.articles[0].responseDescriptions[0].description.text =
    'Identificador numérico do contato, usado como campo contactId na consulta de tags.'; });
  assert.equal(wrongKind.status, 'needs_information');
  assert.match(wrongKind.summary, /nome técnico sem fato: contactId/u);
});

test('resposta sintética usa envelope e campos tipados e passa revisão da M5.56', () => {
  const facts = { ...list, responseFields: [
    { name: 'id', type: 'int' }, { name: 'nome', type: 'string' },
    { name: 'ativo', type: 'bool' }, { name: 'tags', type: 'string[]' },
  ] };
  const rendered = renderApiReference(facts, [], { components: ['Fields', 'Field'], sections: ['Resposta'] });
  const json = JSON.parse(rendered.body.match(/```json\n([\s\S]*?)\n```/u)?.[1] ?? 'null');
  assert.deepEqual(Object.keys(json.dados[0]), facts.responseFields.map((field) => field.name));
  assert.equal(typeof json.dados[0].id, 'number');
  assert.equal(typeof json.dados[0].ativo, 'boolean');
  assert.deepEqual(json.dados[0].tags, ['exemplo']);
  assert.doesNotMatch(rendered.pending.join('; '), /exemplo sintético aguardando/u);
  assert.deepEqual(securityReview({ path: 'api/contatos/buscar-contatos', method: 'GET', endpoint: '/contacts',
    body: rendered.body }, { facts }).blocks, []);
  const mutated = rendered.body.replace(/"id":\s*\d+/u, '"id": "507f1f77bcf86cd799439011"');
  assert.match(securityReview({ path: 'api/contatos/buscar-contatos', method: 'GET', endpoint: '/contacts',
    body: mutated }, { facts }).blocks.join('; '), /id real|ObjectId/iu);
  const named = rendered.body.replace('"nome": "Maria Exemplo"', '"nome": "Maria Silva"');
  assert.match(securityReview({ path: 'api/contatos/buscar-contatos', method: 'GET', endpoint: '/contacts',
    body: named }, { facts }).blocks.join('; '), /nome de pessoa/iu);
});
