import test from 'node:test';
import assert from 'node:assert/strict';
import { planContent, generateContentPackage, validateGroundedOutput } from './content-ai-service.mjs';

const reordered = 'São páginas NOVAS em api/contatos/ (a seção ainda não existe). Nomes: "Buscar contatos" (listagem), "Buscar detalhes do contato" e "Buscar tags do contato".';
const details = 'Nomes: "Buscar contatos" (listagem), "Buscar detalhes do contato" e "Buscar tags do contato". São páginas NOVAS em api/contatos/ (a seção ainda não existe).';
const claim = 'Crie as três páginas de contatos.';
const citation = { source: 'pedido', quote: reordered };
const request = { topic: 'Referência de contatos', module: 'api', details };
const context = { groundingRequired: true, module: 'api', request, existing: [], matches: [{ repository: 'ihelpchat/olah-ihelp', path: 'ContactsController.cs', line: 12, sha: 'a'.repeat(40), ref: 'a'.repeat(40) }], code: [{ available: true }],
  endpoints: [{ public: true, route: '/api/v2/contacts' }], support: { categories: [], rules: [] } };
const output = (cite = citation) => ({ guidance: claim, grounding: [{ text: claim, citations: [cite] }] });

test('quote reordenado do replay real é aceito por segmentos literais', () => {
  assert.equal(validateGroundedOutput(output(), context, ['guidance']), true);
});

test('segmento inventado no quote reordenado é rejeitado', () => {
  const invented = { ...citation, quote: reordered.replace('São páginas NOVAS', 'São páginas ANTIGAS') };
  assert.equal(validateGroundedOutput(output(invented), context, ['guidance']), false);
});

test('quote só com segmentos curtos é rejeitado', () => {
  assert.equal(validateGroundedOutput(output({ ...citation, quote: 'Nomes; api; três' }), context, ['guidance']), false);
});

test('página docs publicada no contexto é citável na API; fora do contexto não', () => {
  const page = { path: 'docs/contatos', description: 'A página explica como encontrar contatos da equipe.' };
  const cite = { source: 'pagina', path: page.path, quote: page.description };
  assert.equal(validateGroundedOutput(output(cite), { ...context, existing: [page] }, ['guidance']), true);
  assert.equal(validateGroundedOutput(output(cite), context, ['guidance']), false);
});

const plan = (cite) => ({ status: 'ready', guidance: claim, questions: [], risks: [], suggestedActions: [],
  grounding: [{ text: claim, citations: [cite] }] });
async function runPlan(responses) {
  const calls = [];
  const result = await planContent(process.cwd(), request, { productContext: context, client: { responses: {
    create: async (payload) => {
      calls.push(payload);
      return { output_text: JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]), model: 'simulado' };
    },
  } } });
  return { result, calls };
}

test('uma citação inválida seguida de válida refaz o plano com a recusa no prompt', async () => {
  const bad = { ...citation, quote: reordered.replace('São páginas NOVAS', 'São páginas ANTIGAS') };
  const { result, calls } = await runPlan([plan(bad), plan(citation)]);
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].input), /São páginas ANTIGAS/);
  assert.match(JSON.stringify(calls[1].input), /não é trecho literal/);
});

test('duas respostas inválidas param após a segunda e informam o motivo', async () => {
  const bad = { ...citation, quote: reordered.replace('São páginas NOVAS', 'São páginas ANTIGAS') };
  const { result, calls } = await runPlan([plan(bad), plan(bad), plan(citation)]);
  assert.equal(result.status, 'needs_evidence');
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(result), /não é trecho literal/);
});

test('recusa de linha de código informa linha fora do índice no retry', async () => {
  const code = { repository: 'ihelpchat/olah-ihelp', path: 'ContactsController.cs', lineStart: 999, lineEnd: 999, sha: 'a'.repeat(40) };
  const { result, calls } = await runPlan([plan(code), plan(citation)]);
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].input), /linha fora do índice/);
});

test('recusa de página fora do contexto informa página não listada no retry', async () => {
  const page = { source: 'pagina', path: 'docs/ausente', quote: 'A página explica como encontrar contatos da equipe.' };
  const { result, calls } = await runPlan([plan(page), plan(citation)]);
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].input), /página não listada/);
});

const endpoint = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  policy: 'authenticated', parameters: [], responseFields: null };
const prose = { path: 'api/contatos/buscar', title: 'Buscar contatos',
  description: 'Consulte os contatos da sua equipe usando a referência pública.', intro: 'A lista mostra os contatos disponíveis.', notas: [],
  grounding: [
    { text: 'Consulte os contatos da sua equipe usando a referência pública.', citations: [citation] },
    { text: 'A lista mostra os contatos disponíveis.', citations: [citation] },
  ] };
const packageResponse = (cite) => ({ status: 'ready', summary: 'Referência para consultar contatos.', questions: [],
  articles: [{ ...prose, grounding: prose.grounding.map((item) => ({ ...item, citations: [cite] })) }],
  grounding: [{ text: 'Referência para consultar contatos.', citations: [citation] }] });
const packageContext = { ...context, endpoints: [endpoint], apiExamples: [{ sections: ['Parâmetros', 'Resposta'],
  baseUrl: 'https://apiv3.ihelpchat.com', components: ['Params', 'Param'], languages: ['bash'] }] };

test('prosa de API rejeitada é gerada uma segunda vez com a recusa no prompt', async () => {
  const bad = { ...citation, quote: reordered.replace('São páginas NOVAS', 'São páginas ANTIGAS') };
  const calls = [];
  const result = await generateContentPackage(process.cwd(), request, { productContext: packageContext,
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      calls.push(payload);
      return { output_text: JSON.stringify(packageResponse(calls.length === 1 ? bad : citation)), model: 'simulado' };
    } } } });
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].input), /não é trecho literal/);
});

test('summary do pacote rejeitado também aciona uma única nova geração', async () => {
  const bad = { ...citation, quote: reordered.replace('São páginas NOVAS', 'São páginas ANTIGAS') };
  const calls = [];
  const result = await generateContentPackage(process.cwd(), request, { productContext: packageContext,
    plan: { status: 'ready' }, client: { responses: { create: async (payload) => {
      calls.push(payload);
      const value = packageResponse(citation);
      value.grounding[0].citations = [bad];
      return { output_text: JSON.stringify(value), model: 'simulado' };
    } } } });
  assert.equal(result.status, 'needs_evidence');
  assert.equal(calls.length, 2);
  assert.match(JSON.stringify(calls[1].input), /não é trecho literal/);
});
