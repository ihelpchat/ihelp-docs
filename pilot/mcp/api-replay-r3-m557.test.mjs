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
  intro: unit('Use para consultar contatos.'), notas: [], responseHeaders: [], responseDescriptions });
const packageOutput = { status: 'ready', summary: [unit('Contatos.')], questions: [], articles: [
  article(source.list.path, 'GET /contacts', [{ name: 'dados[].id', description: {
    ...unit(description), refs: [{ name: 'contactId', endpoint: tags.verb + ' ' + tags.route.replace(/^\/api\/v\d+/u, '') }],
  } }]),
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

test('resp-2 aceita contactId com referência explícita ao endpoint de tags', async () => {
  const result = await replay();
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.articles[0].body, /usado como contactId na consulta de tags/u);
  assert.match(result.articles[0].body, /\[Contatos\]\(\/api\/contatos\/buscar-tags-do-contato\)/u);
});

test('resp-5 corrige refs de parâmetros únicos e entrega as três páginas', async () => {
  const detail = { verb: 'GET', route: '/api/v2/contacts/details/{IdRef}', public: true, documented: true,
    authorization: 'authenticated', parameters: [{ name: 'IdRef', type: 'string', in: 'route' }], responseFields: [] };
  const listed = { ...list, route: '/api/v2/contacts/{letter}',
    parameters: [{ name: 'letter', type: 'string', in: 'route' }],
    responseFields: [{ name: 'id', type: 'int' }, { name: 'idRef', type: 'string' }] };
  const result = await replay((value) => {
    value.articles[0].endpoint = 'GET /contacts/{letter}';
    value.articles[0].responseDescriptions[0].description.refs[0].endpoint = 'GET /contacts/{letter}';
    value.articles[0].responseDescriptions.push({ name: 'dados[].idRef', description: {
      ...unit('Identificador de referência do contato, em texto; é usado na consulta de detalhes.'),
      refs: [{ name: 'idRef', endpoint: 'GET /contacts/{letter}' }],
    } });
    value.articles.splice(1, 0, article('api/contatos/detalhes', 'GET /contacts/details/{IdRef}'));
  }, [listed, detail, tags]);
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.articles.length, 3);
  assert.match(result.articles[0].body, /\/api\/contatos\/buscar-tags-do-contato/u);
  assert.match(result.articles[0].body, /\/api\/contatos\/detalhes/u);
  assert.deepEqual(result.internalRepairs.map(({ name, endpoint }) => [name, endpoint]), [
    ['contactId', 'GET /contactTags/getContactsTagByContactId/{contactId}'],
    ['idRef', 'GET /contacts/details/{IdRef}'],
  ]);
});

test('ref com nome presente em dois endpoints continua recusada', async () => {
  const other = { ...tags, route: '/api/v2/contacts/other/{contactId}' };
  const result = await replay((value) => {
    value.articles.push(article('api/contatos/outra-consulta', 'GET /contacts/other/{contactId}'));
    value.articles[0].responseDescriptions[0].description.refs[0].endpoint = 'GET /contacts';
  }, [list, tags, other]);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /referência inválida: contactId/u);
});

test('nome público WhatsApp é aceito na descrição de campo', async () => {
  const result = await replay((value) => { value.articles[0].responseDescriptions[0].description.text =
    'Campo textual de WhatsApp.'; value.articles[0].responseDescriptions[0].description.refs = []; });
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
  assert.match(result.summary, /referência inválida: contactId/u);
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
