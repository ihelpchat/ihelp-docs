import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateContentPackage, planContent } from './content-ai-service.mjs';
import { renderArticle } from './content-service.mjs';

const replay = JSON.parse(await readFile(new URL('./fixtures/m557-resp3-replay.json', import.meta.url)));
const unit = (text, citations) => ({ text, citations });
const request = { module: 'api', topic: 'Contatos',
  description: 'Criar a seção Contatos da referência da API. Uma página por endpoint. Criar GET /api/v2/contacts e uma página nova em api/contatos/buscar-contatos. Listagem sem o segmento opcional letter.',
  details: 'O idRef do detalhe e o contactId das tags vêm da listagem. Nenhum filtro é obrigatório. searchData é texto livre que casa com trecho do nome ou do número do contato. page começa em 1 e o padrão é 1. limit tem padrão 20.' };
const endpoint = { verb: 'GET', route: '/api/v2/contacts/{letter}', optionalAliases: ['/api/v2/contacts'],
  public: true, documented: false, explicit: true, authorization: 'authenticated',
  parameters: [{ name: 'letter', type: 'string', in: 'route', required: false },
    ...['searchData', 'page', 'limit'].map((name) => ({ name, type: 'string', in: 'query', required: false }))],
  responseFields: [{ name: 'idRef', type: 'string' }] };
const context = { groundingRequired: true, code: [{ available: true }],
  matches: Object.values(replay.citations).flat().filter((item) => item.repository)
    .map((item) => ({ ...item, line: item.lineStart, ref: item.sha })), endpoints: [endpoint],
  apiExamples: [{ sections: ['Parâmetros', 'Resposta'], components: ['Params', 'Param', 'Fields', 'Field'],
    baseUrl: 'https://apiv3.ihelpchat.com' }] };
const summaryText = 'O pacote contém páginas novas da referência de Contatos.';
const base = { status: 'ready', summary: [unit(summaryText, replay.citations.summary)], questions: [], articles: [{
    path: replay.path, endpoint: replay.endpoint, title: replay.title,
    description: unit(replay.description, replay.citations.description), intro: unit(replay.intro, replay.citations.intro),
    notas: replay.notas.map((text) => unit(text, replay.citations.nota)), responseDescriptions: [
      { name: 'idRef', description: unit('Identificador de referência do contato.', replay.citations.responseDescription) },
    ],
  }] };
async function generate(change = () => {}) {
  const value = structuredClone(base);
  change(value);
  return generateContentPackage(process.cwd(), request, { productContext: context, plan: { status: 'ready' },
    client: { responses: { create: async (payload) => {
      assert.equal(payload.text.format.schema.properties.summary.type, 'array');
      assert.ok(!('grounding' in payload.text.format.schema.properties));
      return { output_text: JSON.stringify(value), model: 'replay-offline' };
    } } } });
}

test('resp-3 adaptado: unidades citadas rendem página sem letter', async () => {
  const result = await generate();
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.summary, summaryText, 'consumidor recebe texto, não unidades');
  assert.equal(result.articles[0].endpoint, '/contacts');
  const page = renderArticle(result.articles[0]);
  assert.match(page, /^endpoint: \/contacts$/mu);
  assert.doesNotMatch(page, /letter/u);
  assert.match(result.articles[0].body, /Os filtros de consulta são opcionais/u);
  assert.match(page, /Identificador de referência do contato/u);
});

test('summary API com duas unidades citadas retorna textos juntados', async () => {
  const result = await generate((value) => { value.summary.push(unit('Cada página descreve um endpoint solicitado.', replay.citations.summary)); });
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.summary, `${summaryText} Cada página descreve um endpoint solicitado.`);
});

test('summary API sem citação é rejeitado pelo motivo correto', async () => {
  const result = await generate((value) => { value.summary[0].citations = []; });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /frase sem citação: O pacote contém páginas novas/u);
});

test('summary API sem citação entra na única nova tentativa', async () => {
  let calls = 0;
  const result = await generateContentPackage(process.cwd(), request, { productContext: context, plan: { status: 'ready' },
    client: { responses: { create: async (payload) => {
      calls++;
      if (calls === 2) assert.match(JSON.stringify(payload.input), /frase sem citação: O pacote contém páginas novas/u);
      const value = structuredClone(base);
      if (calls === 1) value.summary[0].citations = [];
      return { output_text: JSON.stringify(value), model: 'replay-offline' };
    } } },
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.summary, summaryText);
});

test('pacote não API mantém summary texto e grounding separado', async () => {
  const text = 'Pacote pronto para revisão.';
  const citation = context.matches.find((item) => item.repository);
  const result = await generateContentPackage(process.cwd(), { topic: 'Contatos', module: 'produto' }, {
    productContext: context, plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      assert.equal(payload.text.format.schema.properties.summary.type, 'string');
      assert.ok(payload.text.format.schema.required.includes('grounding'));
      return { output_text: JSON.stringify({ status: 'ready', summary: text, questions: [], articles: [],
        grounding: [{ text, citations: [{ repository: citation.repository, path: citation.path,
          lineStart: citation.line, lineEnd: citation.line, sha: citation.sha }] }] }), model: 'offline' };
    } } },
  });
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(result.summary, text);
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

test('descrição de campo sem citação é rejeitada com a frase', async () => {
  const result = await generate((value) => { value.articles[0].responseDescriptions[0].description.citations = []; });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /frase sem citação: Identificador de referência do contato/u);
});

async function plan(changedRequest) {
  return planContent(process.cwd(), changedRequest, { productContext: context,
    client: { responses: { create: async (payload) => {
      assert.match(payload.input[0].content, /página nova.*documented=false|documented=false.*página nova/iu);
      return { output_text: JSON.stringify({ status: 'needs_information', guidance: '',
        questions: ['Os endpoints marcados documented=false devem ser publicados?'],
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
