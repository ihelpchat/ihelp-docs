import test from 'node:test';
import assert from 'node:assert/strict';
import { generateContentPackage } from './content-ai-service.mjs';
import { publicScalarType } from './api-public-types.mjs';

// Notes replayed from the saved Buscar contatos response, with the new typed envelope.
const unit = (text) => ({ text, citations: [], refs: [] });
const note = (type, text) => ({ ...unit(text), type });
const endpoint = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  authorization: 'authenticated', parameters: [
    { name: 'departmentIds', type: 'List<int>', in: 'query', required: false },
    { name: 'responsibleUserIds', type: 'List<int>', in: 'query', required: false },
    { name: 'linkedToMe', type: 'bool', in: 'query', required: false },
    { name: 'showAll', type: 'bool', in: 'query', required: false },
    { name: 'page', type: 'int', in: 'query', required: false },
    { name: 'limit', type: 'int', in: 'query', required: false },
    { name: 'searchData', type: 'string', in: 'query', required: false, enumValues: ['9969'] },
    { name: 'export', type: 'bool', in: 'query', required: false },
  ], responseFields: [], responseHeaders: [
    { name: 'Total-Pages', source: 'Controllers/ContactsController.cs:12' },
    { name: 'Total-Pages-Exported', source: 'Repository/ContactsRepository.cs:48' },
  ] };
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
async function generate(outputs, endpointFact = endpoint) {
  let calls = 0;
  const result = await generateContentPackage(process.cwd(), { module: 'api', topic: 'Contatos', confirmations: ['GET /contacts'] }, {
    productContext: { groundingRequired: false, matches: [], code: [], endpoints: [endpointFact],
      apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param', 'Fields', 'Field'] }] },
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      assert.deepEqual(payload.text.format.schema.properties.articles.items.properties.notas.items.properties.type.enum,
        ['Como filtrar', 'Paginação e cabeçalhos', 'Quem vê quais contatos', 'Diferenças e cuidados']);
      assert.deepEqual(payload.text.format.schema.properties.articles.items.properties.responseHeaders.items.properties.name.enum,
        endpointFact.responseHeaders.map((header) => header.name));
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

test('queries de um ou mais pares ficam em uma crase sem afetar identificadores soltos', async () => {
  const cases = [
    ['showAll=false', '`showAll=false`'],
    ['page=1&limit=20', '`page=1&limit=20`'],
    ['?searchData=9969', '`?searchData=9969`'],
    ['Use showAll=false para filtrar.', 'Use `showAll=false` para filtrar.'],
    ['O parâmetro showAll é opcional.', 'O parâmetro `showAll` é opcional.'],
  ];
  for (const [input, expected] of cases) {
    const sample = structuredClone(output);
    sample.articles[0].notas[3].text = input;
    const { result } = await generate([sample]);
    assert.equal(result.status, 'ready', `${input}: ${result.summary}`);
    assert.ok(result.articles[0].body.includes(expected), `${input}: ${result.articles[0].body}`);
  }
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
  assert.deepEqual([...result.articles[0].body.matchAll(/^### .+$/gmu)].map(([title]) => title),
    ['### Paginação e cabeçalhos', '### Diferenças e cuidados']);
});

test('cabeçalhos dos fatos continuam na tabela quando o modelo omite ambos', async () => {
  const omitted = structuredClone(output);
  omitted.articles[0].responseHeaders = [];
  omitted.articles[0].notas = omitted.articles[0].notas.filter((item) => item.type !== 'Paginação e cabeçalhos');
  const { result } = await generate([omitted]);
  assert.equal(result.status, 'ready', result.summary);
  const body = result.articles[0].body;
  assert.match(body, /\| `Total-Pages` \|/u);
  assert.match(body, /\| `Total-Pages-Exported` \|/u);
  assert.equal((body.match(/^\| `Total-Pages(?:-Exported)?` \|/gmu) ?? []).length, 2);
  assert.match(body, /a confirmar/u);
  assert.match(result.pending.join('; '), /descrever cabeçalho Total-Pages(?:-Exported)?/u);
  assert.match(result.pending.join('; '), /descrever cabeçalho Total-Pages-Exported/u);
});

test('cabeçalho parcialmente descrito conserva a outra linha factual', async () => {
  const partial = structuredClone(output);
  partial.articles[0].responseHeaders.pop();
  const { result } = await generate([partial]);
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.articles[0].body, /\| `Total-Pages` \| Conta os contatos/u);
  assert.match(result.articles[0].body, /\| `Total-Pages-Exported` \|.*a confirmar/u);
  assert.match(result.pending.join('; '), /descrever cabeçalho Total-Pages-Exported/u);
});

test('descrição de cabeçalho recusada vira texto factual a confirmar', async () => {
  const refused = structuredClone(output);
  refused.articles[0].responseHeaders[0].meaning.text = 'Use `inventado=1` para habilitar acesso administrativo.';
  const { result } = await generate([refused]);
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.articles[0].body, /\| `Total-Pages` \|.*a confirmar/u);
  assert.doesNotMatch(result.articles[0].body, /inventado=1/u);
  assert.match(result.pending.join('; '), /descrever cabeçalho Total-Pages/u);
});

test('endpoint sem cabeçalhos factuais não produz tabela', async () => {
  const without = { ...endpoint, responseHeaders: [] };
  const sample = structuredClone(output);
  sample.articles[0].responseHeaders = [];
  sample.articles[0].notas = sample.articles[0].notas.filter((item) => item.type !== 'Paginação e cabeçalhos');
  const { result } = await generate([sample], without);
  assert.equal(result.status, 'ready', result.summary);
  assert.doesNotMatch(result.articles[0].body, /\| Cabeçalho \|/u);
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

test('nota que só repete cabeçalhos presentes na tabela é omitida com pendência interna', async () => {
  const repeated = structuredClone(output);
  repeated.articles[0].notas[2].text = 'Total-Pages conta os contatos que atendem aos filtros. Total-Pages-Exported conta os contatos devolvidos.';
  const { result, calls } = await generate([repeated]);
  assert.equal(calls, 1);
  assert.equal(result.status, 'ready', result.summary);
  assert.doesNotMatch(result.articles[0].body, /Total-Pages conta os contatos/u);
  assert.match(result.articles[0].body, /\| `Total-Pages` \|/u);
  assert.match(result.pending.join('; '), /nota.*cabeçalho.*omitida/iu);
});

test('nota mista preserva assunto independente e remove a frase de cabeçalho', async () => {
  const mixed = structuredClone(output);
  mixed.articles[0].notas[2].text = 'Total-Pages conta os contatos filtrados. A consulta aceita filtros combinados.';
  const { result } = await generate([mixed]);
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.articles[0].body, /A consulta aceita filtros combinados/u);
  assert.doesNotMatch(result.articles[0].body, /Total-Pages conta os contatos filtrados/u);
});

test('nota mista separada por ponto e vírgula mantém a orientação independente', async () => {
  const mixed = structuredClone(output);
  mixed.articles[0].notas[2].text = 'Total-Pages conta os contatos filtrados; a consulta aceita filtros combinados.';
  const { result } = await generate([mixed]);
  assert.equal(result.status, 'ready', result.summary);
  assert.match(result.articles[0].body, /a consulta aceita filtros combinados/u);
  assert.doesNotMatch(result.articles[0].body, /Total-Pages conta os contatos filtrados/u);
});

test('cabeçalho inventado é recusado mesmo quando tem formato válido', async () => {
  const invalid = structuredClone(output);
  invalid.articles[0].responseHeaders[0].name = 'X-Admin-Override';
  const { result, calls } = await generate([invalid]);
  assert.equal(calls, 2);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /cabeçalho.*sem fato|cabeçalhos de resposta inválidos/iu);
});

test('valores inline seguem o tipo dos parâmetros dos fatos', async () => {
  const valid = structuredClone(output);
  valid.articles[0].notas[3].text = 'Use `departmentIds=1&departmentIds=2` e `showAll=true`; `false` e `0` são valores válidos.';
  assert.equal((await generate([valid])).result.status, 'ready');
  for (const value of ['`showAll=talvez`', '`inventado=1`']) {
    const invalid = structuredClone(output);
    invalid.articles[0].notas[3].text = `Use ${value} para filtrar.`;
    const { result } = await generate([invalid]);
    assert.equal(result.status, 'needs_information', value);
    assert.match(result.summary, /código inline proibido/u);
  }
});

test('query sem crases também é validada antes de ser marcada', async () => {
  const invalid = structuredClone(output);
  invalid.articles[0].notas[3].text = 'Use inventado=1&inventado=2 para filtrar.';
  const { result, calls } = await generate([invalid]);
  assert.equal(calls, 2);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /query|parâmetro|código inline/iu);
});

test('tipo público escalar das coleções e anuláveis usa a tabela compartilhada', () => {
  for (const type of ['List<int>', 'IEnumerable<int>', 'ICollection<int?>', 'int[]', 'List<int?>?', 'int[]?'])
    assert.equal(publicScalarType(type), 'int', type);
  assert.equal(publicScalarType('List<TipoInterno>'), null);
});
