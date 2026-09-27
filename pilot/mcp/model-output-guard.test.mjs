import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { guardModelOutput } from './model-output-guard.mjs';
import { planContent, generateContentPackage, generateCanonicalGuide } from './content-ai-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const request = { topic: 'Contatos', module: 'api', description: 'GET /api/v2/contacts/{contactId}' };
const sql = 'SELECT c.EmpresaId FROM Contato c WHERE c.EmpresaId = @businessId';
const method = 'if ( filters . Export ) return repository . Query ( filters ) ;';
const context = {
  groundingRequired: false, code: [], matches: [], support: { categories: [], rules: [] }, coverage: [],
  endpoints: [{ public: true, documented: true, explicit: true, verb: 'GET', route: '/api/v2/contacts/{contactId}', parameters: [], responseFields: [], authorization: 'authenticated' }],
  callEvidence: [sql, method].map((excerpt, index) => ({ path: `Comzada.Service/ServicesMySQL/Part${index}.cs`, start: 1, end: 1, excerpt })),
};
const plan = (guidance) => ({ status: 'ready', guidance, questions: [], risks: [], suggestedActions: [], grounding: [] });
const client = (output) => ({ responses: { create: async () => ({ output_text: JSON.stringify(output), model: 'simulado' }) } });

test('SQL do callEvidence ecoado no guidance é omitido e avisado', async () => {
  const result = await planContent(root, request, { productContext: context, client: client(plan(`Confira ${sql} antes de publicar.`)) });
  assert.equal(result.status, 'ready');
  assert.doesNotMatch(result.guidance, /SELECT c\.EmpresaId/u);
  assert.match(result.guidance, /\[trecho de código interno omitido\]/u);
  assert.equal(result.internalCodeEcho, 1);
});

test('JSON cercado por texto passa pelo mesmo guard usado pelo parser', async () => {
  const output_text = `Resposta: ${JSON.stringify(plan(sql))}`;
  const result = await planContent(root, request, { productContext: context,
    client: { responses: { create: async () => ({ output_text, model: 'simulado' }) } } });
  assert.doesNotMatch(result.guidance, /SELECT c\.EmpresaId/u);
  assert.equal(result.internalCodeEcho, 1);
});

test('oito tokens de método de serviço são omitidos; sete são preservados', () => {
  const eight = 'if ( filters . Export ) return repository';
  const seven = 'if ( filters . Export ) return';
  const positive = guardModelOutput({ guidance: eight }, context, 'internal');
  assert.match(positive.value.guidance, /\[trecho de código interno omitido\]/u);
  assert.equal(positive.internalCodeEcho, 1);
  const negative = guardModelOutput({ guidance: seven }, context, 'internal');
  assert.equal(negative.value.guidance, seven);
  assert.equal(negative.internalCodeEcho, 0);
});

test('rota e nomes públicos são preservados', () => {
  const guidance = 'Use /api/v2/contacts/{contactId} com contactId e limit.';
  const routeContext = { ...context, callEvidence: [...context.callEvidence,
    { path: 'Comzada.Service/ServicesMySQL/RouteService.cs', excerpt: 'var route = "/api/v2/contacts/{contactId}";' }] };
  const result = guardModelOutput({ guidance }, routeContext, 'internal');
  assert.equal(result.value.guidance, guidance);
  assert.equal(result.internalCodeEcho, 0);
});

test('código do controller fica fora da evidência privada', () => {
  const controllerContext = { ...context, callEvidence: [], matches: [
    { path: 'Controllers/V2/ContactsController.cs', excerpt: method },
  ] };
  const guidance = 'if ( filters . Export ) return repository';
  assert.equal(guardModelOutput({ guidance }, controllerContext, 'internal').value.guidance, guidance);
});

test('SQL por forma é omitido mesmo fora da evidência', () => {
  const result = guardModelOutput({ guidance: 'Evite SELECT private FROM hidden;' }, { ...context, callEvidence: [] }, 'internal');
  assert.match(result.value.guidance, /\[trecho de código interno omitido\]/u);
  assert.equal(result.internalCodeEcho, 1);
});

test('página com SQL não fica ready nem pode ser gravada', async () => {
  const output = { status: 'ready', summary: 'Páginas geradas.', questions: [], grounding: [], articles: [
    { path: 'api/contatos/listar', endpoint: 'GET /contacts/{contactId}', title: 'Contatos', description: sql, intro: 'Consulte contatos.', notas: [], grounding: [] },
  ] };
  const result = await generateContentPackage(root, request, { productContext: context, plan: plan('Documente contatos.'), client: client(output) });
  assert.notEqual(result.status, 'ready');
  assert.deepEqual(result.articles, []);
  assert.match(`${result.summary} ${result.questions?.join(' ')}`, /a página copia código interno do back/u);
  assert.equal(result.internalCodeEcho, 1);
});

test('plano, pacote e guia usam o único guard na saída do provider', async () => {
  const source = await readFile(new URL('./content-ai-service.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/client\.responses\.create\(/gu) ?? []).length, 1);
  assert.equal((source.match(/modelResponse\(/gu) ?? []).length, 4);
  assert.equal((source.match(/guardModelOutput\(/gu) ?? []).length, 1);
  for (const operation of [
    () => planContent(root, request, { productContext: context, client: client(plan(sql)) }),
    () => generateContentPackage(root, request, { productContext: context, plan: plan('Documente.'), client: client({ status: 'needs_information', summary: sql, questions: [sql], articles: [], grounding: [] }) }),
    () => generateCanonicalGuide(root, { ...request, guideId: 'contatos' }, { productContext: context, client: client({ status: 'needs_information', questions: [sql], article: null }) }),
  ]) {
    const result = await operation();
    assert.doesNotMatch(JSON.stringify(result), /SELECT c\.EmpresaId/u);
    assert.match(JSON.stringify(result), /trecho de código interno omitido/u);
  }
});
