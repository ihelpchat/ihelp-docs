import test from 'node:test';
import assert from 'node:assert/strict';
import { generateContentPackage } from './content-ai-service.mjs';

const facts = [
  { verb: 'GET', route: '/api/v2/contacts', parameters: [{ name: 'page', type: 'int', in: 'query' }] },
  { verb: 'GET', route: '/api/v2/contacts/details/{IdRef}', parameters: [{ name: 'IdRef', type: 'string', in: 'route' }] },
  { verb: 'GET', route: '/api/v2/contactTags/getContactsTagByContactId/{contactId}', parameters: [{ name: 'contactId', type: 'int', in: 'route' }] },
].map((fact) => ({ ...fact, public: true, documented: true, policy: 'authenticated', responseFields: [] }));
const ids = ['GET /contacts', 'GET /contacts/details/{IdRef}', 'GET /contactTags/getContactsTagByContactId/{contactId}'];
const paths = ['api/contatos/buscar-contatos', 'api/contatos/detalhes-do-contato', 'api/contatos/tags-do-contato'];
const style = { sections: ['Parâmetros', 'Exemplo', 'Resposta'], baseUrl: 'https://apiv3.ihelpchat.com',
  components: ['Params', 'Param', 'CodeTabs', 'Fields', 'Field'], languages: ['bash'] };
const request = { topic: 'Contatos', module: 'api', description: 'Criar páginas novas em api/contatos/.' };
const prose = ids.map((endpoint, index) => ({ endpoint, path: paths[index], title: `Página ${index + 1}`,
  description: 'Consulte os contatos disponíveis.', intro: 'Use a referência para consultar os dados.', notas: [], grounding: [] }));
const positive = { status: 'ready', summary: 'Referência de contatos.', questions: [], articles: prose, grounding: [] };
const context = { groundingRequired: false, matches: [], code: [], endpoints: facts, apiExamples: [style] };

async function run(change = () => {}, changedContext = context) {
  const response = structuredClone(positive);
  change(response);
  let schema;
  const result = await generateContentPackage(process.cwd(), request, { productContext: changedContext, plan: { status: 'ready' },
    client: { responses: { create: async (payload) => {
      schema = payload.text.format.schema;
      return { output_text: JSON.stringify(response), model: 'simulado' };
    } } } });
  return { result, schema };
}

test('três páginas novas escolhem fatos distintos e renderizam método, rota e parâmetro', async () => {
  const { result, schema } = await run();
  assert.equal(result.status, 'ready', result.questions?.join('; '));
  assert.deepEqual(schema.properties.articles.items.properties.endpoint.enum, ids);
  assert.deepEqual(result.articles.map((article) => [article.path, article.method, article.endpoint]),
    paths.map((path, index) => [path, 'GET', ids[index].slice(4)]));
  for (const [index, name] of ['page', 'IdRef', 'contactId'].entries()) {
    assert.match(result.articles[index].body, new RegExp(`<Param name="${name}"`));
  }
});

for (const [name, change, reason] of [
  ['endpoint fora do enum', (value) => { value.articles[0].endpoint = 'GET /private'; }, /endpoint fora da lista: GET \/private/],
  ['endpoint repetido', (value) => { value.articles[1].endpoint = ids[0]; }, /endpoint repetido: GET \/contacts/],
  ['endpoint sem página', (value) => { value.articles.pop(); }, /endpoint sem página: GET \/contactTags\/getContactsTagByContactId\/\{contactId\}/],
  ['path fora da seção pedida', (value) => { value.articles[0].path = 'api/outra/buscar-contatos'; }, /path fora da seção pedida/],
]) test(`rejeita ${name} com motivo`, async () => {
  const { result } = await run(change);
  assert.equal(result.status, 'needs_information');
  assert.deepEqual(result.articles, []);
  assert.match(result.questions.join(' '), reason);
});

test('página existente não pode escolher endpoint divergente', async () => {
  const page = { ...style, path: paths[0], frontmatter: { method: 'POST', endpoint: '/contacts' } };
  const { result } = await run(() => {}, { ...context, apiExamples: [page] });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), /endpoint divergente da página publicada/);
});
