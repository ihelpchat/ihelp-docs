import test from 'node:test';
import assert from 'node:assert/strict';
import { planContent, validateGroundedOutput } from './content-ai-service.mjs';

// Minimal cases taken from the saved, sanitized planning response in the M5.49 brief.
const sha = '71f8201dcc027b1f4b1c5266b3976a8001ae80a0';
const repository = 'ihelpchat/olah-ihelp';
const path = 'Comzada.Domain/EntitiesV2/Contato/Filters.cs';
const request = { topic: 'Contatos', module: 'api', description: 'Criar a seção Contatos da referência da API.',
  details: 'Documentar os filtros da listagem de contatos.' };
const page = { path: 'api/crm/opcoes-de-filtro/buscar-contatos', title: 'Buscar contatos',
  description: 'Busca contatos por nome ou telefone com paginação. A query exige no mínimo 2 caracteres.',
  body: 'Busque contatos por nome ou telefone.' };
const context = { groundingRequired: true, module: 'api', request, code: [{ available: true }],
  matches: [{ repository, path, sha, ref: sha, line: 16 }], endpoints: [], existing: [page],
  apiExamples: [{ path: 'api/contatos/buscar', content: '---\ntitle: Buscar contatos\ndescription: Consulte os contatos.\n---\n## Parâmetros' }] };
const claim = 'Documente os filtros da listagem.';
const cite = (lineStart, lineEnd = lineStart) => ({ repository, path, sha, lineStart, lineEnd });
const grounded = (citation) => ({ guidance: claim, grounding: [{ text: claim, citations: [citation] }] });
const valid = (citation, changedContext = context) => validateGroundedOutput(grounded(citation), changedContext, ['guidance']);
async function rejected(citation, changedContext = context) {
  const output = { status: 'ready', guidance: claim, questions: [], risks: [], suggestedActions: [], grounding: grounded(citation).grounding };
  const result = await planContent(process.cwd(), request, { productContext: { ...changedContext,
    endpoints: [{ public: true, documented: true }] }, client: { responses: { create: async () => ({ output_text: JSON.stringify(output) }) } } });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /não está vinculada às linhas do código recuperado/u);
}

test('faixa 16-26 contendo a linha indexada é aceita', () => {
  assert.equal(valid(cite(16, 26)), true);
});

for (const [name, change] of [
  ['faixa de 100 linhas', (citation) => { citation.lineEnd = 115; }],
  ['faixa sem linha indexada', (citation) => { citation.lineStart = 17; }],
  ['SHA diferente', (citation) => { citation.sha = 'b'.repeat(40); }],
]) test(`${name} é rejeitada com motivo`, async () => {
  const citation = cite(16, 26);
  const changedContext = structuredClone(context);
  change(citation, changedContext);
  await rejected(citation, changedContext);
});

test('faixa 30-70 é rejeitada', async () => {
  const citation = cite(16, 26);
  citation.lineStart = 30;
  citation.lineEnd = 70;
  await rejected(citation);
});

test('linha única 1 com só a linha 2 indexada é rejeitada', async () => {
  const changedContext = structuredClone(context);
  changedContext.matches[0].line = 2;
  await rejected(cite(1), changedContext);
});

test('faixa 1-2 contendo só a linha 2 é aceita, mas 3-5 não', () => {
  const changedContext = structuredClone(context);
  changedContext.matches[0].line = 2;
  assert.equal(valid(cite(1, 2), changedContext), true);
  assert.equal(valid(cite(3, 5), changedContext), false);
});

test('página publicada no contexto pode sustentar quote literal', () => {
  assert.equal(valid({ source: 'pagina', path: page.path, quote: 'Busca contatos por nome ou telefone' }), true);
  assert.equal(valid({ source: 'pagina', path: 'api/contatos/buscar', quote: 'Consulte os contatos.' }), true);
});

for (const [name, change] of [
  ['path não listado', (citation) => { citation.path = 'api/outra-pagina'; }],
  ['JSON interno de formato', (citation) => { citation.quote = '"paramNames":["searchData","page","limit"]'; }],
]) test(`citação de página rejeita ${name} com motivo`, async () => {
  const citation = { source: 'pagina', path: page.path, quote: 'Busca contatos por nome ou telefone' };
  change(citation);
  assert.equal(valid(citation), false);
  await rejected(citation);
});

test('rótulo do prompt não é citação do pedido', async () => {
  await rejected({ source: 'pedido', quote: `Objetivo: ${request.description}` });
  assert.equal(valid({ source: 'pedido', quote: request.description }), true);
});

test('prompt delimita pedido cru e distingue fontes de página', async () => {
  const productContext = { ...context, endpoints: [{ public: true, documented: true }], apiExamples: context.apiExamples };
  let prompt;
  await planContent(process.cwd(), request, { productContext, client: { responses: { create: async (payload) => {
    prompt = payload.input;
    return { output_text: JSON.stringify({ status: 'needs_information', guidance: '', questions: [], risks: [], suggestedActions: [], grounding: [] }) };
  } } } });
  assert.match(prompt[1].content, /<<PEDIDO>>\nCriar a seção Contatos da referência da API\.\nDocumentar os filtros da listagem de contatos\.\n<<FIM DO PEDIDO>>/u);
  assert.match(prompt[0].content, /source: ?["']pedido["'].*bloco|source: ?["']pagina["']/iu);
});
