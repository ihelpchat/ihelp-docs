import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planContent } from './content-ai-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const sha = 'a'.repeat(40);
const repository = 'ihelpchat/olah-ihelp';
const path = 'Controllers/ContactsController.cs';
const request = { topic: 'Contatos', module: 'api', description: 'Documentar a busca de contatos.',
  details: 'A consulta retorna os contatos cadastrados.' };
const endpoint = {
  repository, file: path, sha, public: true, documented: true, verb: 'GET', route: '/api/v2/contacts/{letter}',
  source: `${path}:5`, routeSource: `${path}:2`, actionRouteSource: `${path}:5`,
  verbSource: `${path}:5`, authorizationSource: `${path}:1`,
  parameters: [{ name: 'letter', in: 'route', source: `${path}:6` },
    { name: 'searchData', in: 'query', source: 'Dto/Filters.cs:16' },
    { name: 'name', in: 'body', source: 'Dto/ContactInput.cs:8' }],
  responseFields: [{ name: 'id', source: 'Dto/ContactOutput.cs:10' }],
};
const context = { groundingRequired: true, code: [{ available: true }],
  matches: [{ repository, path, sha, ref: sha, line: 30 }], endpoints: [endpoint],
  support: { categories: [], rules: [] }, coverage: [] };
const citation = (citedPath, line) => ({ repository, path: citedPath, sha, lineStart: line, lineEnd: line });
const guidance = 'A rota consulta os contatos.';
const output = { status: 'ready', guidance, questions: [], risks: [], suggestedActions: [],
  grounding: [{ text: guidance, citations: [citation(path, 2)] }] };
async function plan(value = output, changedRequest = request) {
  return planContent(root, changedRequest, { productContext: context,
    client: { responses: { create: async (payload) => {
      if (changedRequest.module === 'api') assert.match(JSON.stringify(payload.text.format.schema), /"source"/);
      return { model: 'simulado', output_text: JSON.stringify(value) };
    } } } });
}

test('planejamento aceita proveniência de rota fora dos matches', async () => {
  const result = await plan();
  assert.equal(result.status, 'ready', result.summary ?? result.questions?.join('; '));
});

test('planejamento rejeita linha fora de matches e fatos com motivo', async () => {
  const changed = structuredClone(output);
  changed.grounding[0].citations[0] = citation(path, 999);
  const result = await plan(changed);
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /não está vinculada às linhas do código recuperado/i);
});

test('índice inclui autorização, verbo, parâmetros e DTOs com SHA exato', async () => {
  for (const [citedPath, line] of [[path, 1], [path, 5], [path, 6],
    ['Dto/Filters.cs', 16], ['Dto/ContactInput.cs', 8], ['Dto/ContactOutput.cs', 10]]) {
    const changed = structuredClone(output);
    changed.grounding[0].citations = [citation(citedPath, line)];
    assert.equal((await plan(changed)).status, 'ready', `${citedPath}:${line}`);
  }
  const changed = structuredClone(output);
  changed.grounding[0].citations[0].sha = 'b'.repeat(40);
  assert.equal((await plan(changed)).status, 'needs_evidence');
});

test('planejamento de API aceita citação literal do pedido', async () => {
  const changed = structuredClone(output);
  changed.grounding[0].citations = [{ source: 'pedido', quote: request.details }];
  assert.equal((await plan(changed)).status, 'ready');
});

test('mesma citação do pedido é rejeitada no planejamento de guia', async () => {
  const changed = structuredClone(output);
  changed.grounding[0].citations = [{ source: 'pedido', quote: request.details }];
  const result = await plan(changed, { ...request, module: 'Contatos' });
  assert.equal(result.status, 'needs_evidence');
  assert.match(result.summary, /não está vinculada às linhas do código recuperado/i);
});

test('todos os pontos de validação usam o contexto único', async () => {
  const source = await readFile(new URL('./content-ai-service.mjs', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/groundingIssues\(/gu)].slice(2);
  assert.equal(calls.length, 5);
  assert.equal([...source.matchAll(/groundingIssues\([^\n]*groundingContext\(/gu)].length, calls.length);
});
