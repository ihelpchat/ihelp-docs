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

for (const [source, citedContext, path] of [
  ['pedido', context, undefined],
  ['pagina', { ...context, existing: [{ path: 'docs/contatos', description: details }] }, 'docs/contatos'],
]) {
  const cite = (quote) => ({ source, ...(path ? { path } : {}), quote });
  test(`${source}: segmento curto inventado após trecho literal é rejeitado`, () => {
    assert.equal(validateGroundedOutput(output(cite(`${reordered} INVENTADO.`)), citedContext, ['guidance']), false);
  });
  test(`${source}: segmentos literais reordenados são aceitos`, () => {
    assert.equal(validateGroundedOutput(output(cite(reordered)), citedContext, ['guidance']), true);
  });
  test(`${source}: pontuação final alterada é rejeitada`, () => {
    const literal = 'A ação está autorizada.';
    const sourceContext = source === 'pedido'
      ? { ...citedContext, request: { ...request, details: literal } }
      : { ...citedContext, existing: [{ path, description: literal }] };
    assert.equal(validateGroundedOutput(output(cite('A ação está autorizada?')), sourceContext, ['guidance']), false);
    assert.equal(validateGroundedOutput(output(cite('A ação está autorizada!')), sourceContext, ['guidance']), false);
    assert.equal(validateGroundedOutput(output(cite('A ação está autorizada.')), sourceContext, ['guidance']), true);
    assert.equal(validateGroundedOutput(output(cite('A ação está autorizada')), sourceContext, ['guidance']), true);
  });
  test(`${source}: pontuação de segmento intermediário alterada é rejeitada`, () => {
    const sourceContext = source === 'pedido'
      ? { ...citedContext, request: { ...request, details: 'Primeira ação autorizada. Segunda ação confirmada.' } }
      : { ...citedContext, existing: [{ path, description: 'Primeira ação autorizada. Segunda ação confirmada.' }] };
    assert.equal(validateGroundedOutput(output(cite('Primeira ação autorizada? Segunda ação confirmada.')), sourceContext, ['guidance']), false);
  });
  test(`${source}: apenas segmentos literais curtos não cumprem o mínimo`, () => {
    assert.equal(validateGroundedOutput(output(cite('Nomes; três')), citedContext, ['guidance']), false);
  });
}

test('página docs publicada no contexto é citável na API; fora do contexto não', () => {
  const page = { path: 'docs/contatos', description: 'A página explica como encontrar contatos da equipe.' };
  const cite = { source: 'pagina', path: page.path, quote: page.description };
  assert.equal(validateGroundedOutput(output(cite), { ...context, existing: [page] }, ['guidance']), true);
  assert.equal(validateGroundedOutput(output(cite), context, ['guidance']), false);
});

const plan = (cite) => ({ status: 'ready', guidance: claim, questions: [], risks: [], suggestedActions: [],
  grounding: [{ text: claim, citations: [cite] }] });
async function runPlan(responses, changedRequest = request) {
  const calls = [];
  const result = await planContent(process.cwd(), changedRequest, { productContext: context, client: { responses: {
    create: async (payload) => {
      calls.push(payload);
      return { output_text: JSON.stringify(responses[Math.min(calls.length - 1, responses.length - 1)]), model: 'simulado' };
    },
  } } });
  return { result, calls };
}

test('citação inválida na orientação interna de API não refaz o plano', async () => {
  const bad = { ...citation, quote: reordered.replace('São páginas NOVAS', 'São páginas ANTIGAS') };
  const { result, calls } = await runPlan([plan(bad), plan(citation)]);
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 1);
});

const endpoint = { verb: 'GET', route: '/api/v2/contacts', public: true, documented: true,
  policy: 'authenticated', parameters: [], responseFields: null };
const prose = { path: 'api/contatos/buscar', endpoint: 'GET /contacts', title: 'Buscar contatos',
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

test('plano de API sem citação na orientação segue para geração', async () => {
  const calls = [];
  const result = await generateContentPackage(process.cwd(), request, { productContext: packageContext,
    client: { responses: { create: async () => {
      calls.push(1);
      const value = calls.length === 1
        ? { ...plan(citation), grounding: [], guidance: 'Oriente a criação das páginas de contatos.' }
        : packageResponse(citation);
      return { output_text: JSON.stringify(value), model: 'simulado' };
    } } } });
  assert.equal(result.status, 'ready', result.summary);
  assert.equal(calls.length, 2, 'a geração deve acontecer após o plano');
});

test('plano de API rejeita nome técnico ausente dos fatos, mesmo sem exigir citação', async () => {
  const { result } = await runPlan([{ ...plan(citation), grounding: [], guidance: 'O campo segredo identifica o contato.' }]);
  assert.equal(result.status, 'needs_information');
  assert.match(result.summary, /nome técnico sem fato: segredo/i);
});

test('plano de API aceita path editorial do pedido na guidance', async () => {
  const { result } = await runPlan([{ ...plan(citation), guidance: 'Crie páginas novas em `api/contatos/`.' }],
    { ...request, details: `${details} Páginas novas em api/contatos/.` });
  assert.equal(result.status, 'ready', result.summary);
});

test('plano de guia sem citação continua bloqueado com motivo', async () => {
  const guideContext = { ...context, module: 'guia' };
  const result = await planContent(process.cwd(), { ...request, module: 'guia' }, { productContext: guideContext,
    client: { responses: { create: async () => ({ output_text: JSON.stringify({ ...plan(citation), grounding: [] }), model: 'simulado' }) } } });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /frase sem citação: Crie as três páginas de contatos/);
});

for (const moduleName of ['api', 'guia']) {
  test(`${moduleName}: marcador [1] em linha isolada não é afirmação`, () => {
    const grounded = { guidance: `${claim}\n[1]`, grounding: [{ text: claim, citations: [
      moduleName === 'api' ? citation : { repository: context.matches[0].repository, path: context.matches[0].path,
        lineStart: 12, lineEnd: 12, sha: context.matches[0].sha },
    ] }] };
    assert.equal(validateGroundedOutput(grounded, { ...context, module: moduleName }, ['guidance']), true);
  });
}

test('prosa de API gerada sem citação continua bloqueada com motivo', async () => {
  const result = await generateContentPackage(process.cwd(), request, { productContext: packageContext,
    plan: { status: 'ready' }, client: { responses: { create: async () => {
      const value = packageResponse(citation);
      value.articles[0].grounding = [];
      return { output_text: JSON.stringify(value), model: 'simulado' };
    } } } });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /frase sem citação: Consulte os contatos/);
});
