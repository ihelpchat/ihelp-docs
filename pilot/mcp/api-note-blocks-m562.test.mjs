import test from 'node:test';
import assert from 'node:assert/strict';
import { generateContentPackage } from './content-ai-service.mjs';

// Notes replayed from the saved Buscar contatos response, with the new typed envelope.
const unit = (text) => ({ text, citations: [], refs: [] });
const note = (type, text) => ({ ...unit(text), type });
const endpoint = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  authorization: 'authenticated', parameters: [
    { name: 'departmentIds', type: 'int[]', in: 'query', required: false },
    { name: 'responsibleUserIds', type: 'int[]', in: 'query', required: false },
    { name: 'linkedToMe', type: 'bool', in: 'query', required: false },
    { name: 'showAll', type: 'bool', in: 'query', required: false },
    { name: 'export', type: 'bool', in: 'query', required: false },
  ], responseFields: [] };
const article = { path: 'api/contatos/buscar-contatos', endpoint: 'GET /contacts', title: 'Buscar contatos',
  description: unit('Consulta os contatos disponíveis com filtros opcionais na referência pública.'), intro: unit('Use esta consulta para localizar contatos.'),
  notas: [
    note('Diferenças e cuidados', 'Esta consulta é diferente da página Buscar contatos do CRM, que representa outro endpoint e exige pelo menos 2 caracteres na busca.'),
    note('Quem vê quais contatos', 'linkedToMe não é controlado pelo cliente: o serviço ignora o valor enviado e recalcula o comportamento, que só fica ativo para perfil Atendente quando a empresa tem Carterizado ativo.'),
    note('Paginação e cabeçalhos', 'Os dois cabeçalhos aparecem quando showAll=false, inclusive com export=true, e nenhum deles aparece quando showAll=true.'),
    note('Como filtrar', 'As listas departmentIds e responsibleUserIds são enviadas repetindo o parâmetro, como departmentIds=1&departmentIds=2.'),
  ],
  responseHeaders: [
    { name: 'Total-Pages', meaning: unit('Conta os contatos que atendem aos filtros.'), when: unit('Aparece quando showAll é falso.') },
    { name: 'Total-Pages-Exported', meaning: unit('Conta os contatos devolvidos na chamada.'), when: unit('Aparece quando showAll é falso.') },
  ], responseDescriptions: [], parameterDescriptions: endpoint.parameters.map((parameter) =>
    ({ name: parameter.name, description: unit(`Filtro ${parameter.name}.`) })) };
const output = { status: 'ready', summary: [unit('Referência de contatos.')], questions: [], articles: [article] };
async function generate(outputs) {
  let calls = 0;
  const result = await generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos', confirmations: ['GET /contacts'] }, {
    productContext: { groundingRequired: false, matches: [], code: [], endpoints: [endpoint],
      apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param', 'Fields', 'Field'] }] },
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      assert.deepEqual(payload.text.format.schema.properties.articles.items.properties.notas.items.properties.type.enum,
        ['Como filtrar', 'Paginação e cabeçalhos', 'Quem vê quais contatos', 'Diferenças e cuidados']);
      return { output_text: JSON.stringify(outputs[Math.min(calls++, outputs.length - 1)]), model: 'replay-offline' };
    } } },
  });
  return { result, calls };
}

test('Buscar contatos: quatro blocos na ordem fixa, tabela, query inteira e autenticação antes dos parâmetros', async () => {
  const { result } = await generate([output]);
  assert.equal(result.status, 'ready', result.summary);
  const body = result.articles[0].body;
  const titles = ['### Como filtrar', '### Paginação e cabeçalhos', '### Quem vê quais contatos', '### Diferenças e cuidados'];
  assert.deepEqual([...body.matchAll(/^### .+$/gmu)].map(([title]) => title), titles);
  assert.match(body, /`departmentIds=1&departmentIds=2`/u);
  assert.doesNotMatch(body, /`departmentIds`=1/u);
  assert.match(body, /\| `Total-Pages` \| Conta os contatos/u);
  assert.match(body, /\| `Total-Pages-Exported` \| Conta os contatos/u);
  assert.ok(body.indexOf('## Autenticação') < body.indexOf('## Parâmetros'));
});

test('nota sem tipo aciona uma nova tentativa e continua recusada se persistir', async () => {
  const invalid = structuredClone(output);
  delete invalid.articles[0].notas[0].type;
  const { result, calls } = await generate([invalid]);
  assert.equal(calls, 2);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /tipo de nota ausente ou inválido/u);
});

test('tipo livre é recusado e bloco vazio não aparece', async () => {
  const invalid = structuredClone(output);
  invalid.articles[0].notas[0].type = 'Outros';
  assert.equal((await generate([invalid])).result.status, 'needs_information');
  const sparse = structuredClone(output);
  sparse.articles[0].notas = sparse.articles[0].notas.slice(0, 1);
  sparse.articles[0].responseHeaders = [];
  const { result } = await generate([sparse]);
  assert.equal(result.status, 'ready', result.summary);
  assert.deepEqual([...result.articles[0].body.matchAll(/^### .+$/gmu)].map(([title]) => title), ['### Diferenças e cuidados']);
});

test('cabeçalho escrito na nota exige tabela na nova tentativa', async () => {
  const invalid = structuredClone(output);
  invalid.articles[0].notas[2].text = 'Total-Pages conta os contatos filtrados.';
  invalid.articles[0].responseHeaders = [];
  const { result, calls } = await generate([invalid]);
  assert.equal(calls, 2);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /cabeçalhos de resposta devem ficar na tabela/u);
});
