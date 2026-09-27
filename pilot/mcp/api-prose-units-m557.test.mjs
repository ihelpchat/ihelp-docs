import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateContentPackage, planContent } from './content-ai-service.mjs';

const replay = JSON.parse(await readFile(new URL('./fixtures/m557-resp3-replay.json', import.meta.url)));
const citation = replay.citation;
const unit = (text) => ({ text, citations: [citation] });
const request = { module: 'api', topic: 'Contatos', description: 'Criar GET /api/v2/contacts e uma página nova em api/contatos/buscar-contatos. Listagem sem o segmento opcional letter.' };
const endpoint = { verb: 'GET', route: '/api/v2/contacts/{letter}', optionalAliases: ['/api/v2/contacts'],
  public: true, documented: false, explicit: true, authorization: 'authenticated',
  parameters: [{ name: 'letter', type: 'string', in: 'route', required: false },
    ...['searchData', 'page', 'limit'].map((name) => ({ name, type: 'string', in: 'query', required: false }))],
  responseFields: [{ name: 'idRef', type: 'string' }] };
const context = { groundingRequired: true, code: [{ available: true }],
  matches: [{ ...citation, line: citation.lineStart, ref: citation.sha }], endpoints: [endpoint],
  apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param', 'Fields', 'Field'],
    baseUrl: 'https://apiv3.ihelpchat.com' }] };
const base = { status: 'ready', summary: replay.summary, questions: [],
  grounding: [{ text: replay.summary, citations: [citation] }], articles: [{
    path: replay.path, endpoint: replay.endpoint, title: replay.title,
    description: unit(replay.description), intro: unit(replay.intro),
    notas: replay.notas.map(unit), responseDescriptions: [],
  }] };
async function generate(change = () => {}) {
  const value = structuredClone(base);
  change(value);
  return generateContentPackage(process.cwd(), request, { productContext: context, plan: { status: 'ready' },
    client: { responses: { create: async () => ({ output_text: JSON.stringify(value), model: 'replay-offline' }) } } });
}

test('resp-3 adaptado: unidades citadas rendem página sem letter', async () => {
  const result = await generate();
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.articles[0].endpoint, '/contacts');
  assert.doesNotMatch(result.articles[0].body, /name="letter"/u);
  assert.match(result.articles[0].body, /Os filtros de consulta são opcionais/u);
});

test('intro sem citação mantém motivo frase sem citação', async () => {
  const result = await generate((value) => { value.articles[0].intro.citations = []; });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /frase sem citação: Use esta página/u);
});

test('duas frases numa unidade são rejeitadas', async () => {
  const result = await generate((value) => { value.articles[0].intro.text += ' Consulte os dados.'; });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /uma frase por item: Use esta página/u);
});

async function plan(changedRequest) {
  return planContent(process.cwd(), changedRequest, { productContext: context,
    client: { responses: { create: async (payload) => {
      assert.match(payload.input[0].content, /página nova.*documented=false|documented=false.*página nova/iu);
      return { output_text: JSON.stringify({ status: 'needs_information', guidance: '',
        questions: ['O endpoint marcado documented=false deve ser publicado em api/contatos/buscar-contatos?'],
        risks: [], suggestedActions: [], grounding: [] }), model: 'offline' };
    } } } });
}
test('pergunta documented=false é descartada e registrada quando caminho novo foi pedido', async () => {
  const result = await plan(request);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.questions, []);
  assert.match(result.discardedQuestions.join(' '), /documented=false/u);
});
test('pergunta documented=false permanece sem caminho novo no pedido', async () => {
  const result = await plan({ ...request, description: 'Criar GET /api/v2/contacts.' });
  assert.equal(result.status, 'needs_information');
  assert.match(result.questions.join(' '), /documented=false/u);
});
