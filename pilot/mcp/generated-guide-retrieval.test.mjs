import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { retrieveContext } from './assistant-service.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const question of ['Como criar uma etiqueta?', 'Como mudar a foto do meu perfil?', 'Como editar um perfil de acesso?']) {
  test(`unsupported procedure avoids unrelated sources: ${question}`, async () => {
    const sources = await retrieveContext(root, question, 8, { scope: 'Ajuda e FAQ', procedure: true });
    assert.equal(sources.length, 0);
  });
}
test('transfer retrieval is one section of Atendimento, not robots/contacts', async () => {
  const sources = await retrieveContext(root, 'Como transferir um atendimento?', 8, { scope: 'Ajuda e FAQ', procedure: true });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].path, '/docs/sobre-o-sistema/atendimento');
  assert.equal(sources[0].documentedSteps.length, 4);
  assert.match(sources[0].documentedSteps[0], /Transferir/);
});
test('quick reply retrieval has only Atalhos and its own route', async () => {
  const sources = await retrieveContext(root, 'Como criar uma resposta rápida?', 8, { scope: 'Ajuda e FAQ', procedure: true });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].path, '/docs/sobre-o-sistema/configuracoes/atalhos');
  assert.deepEqual(sources[0].procedureRoutes, ['/configuracoes/atalhos']);
});

import { prepareGuideContext, generateGuide } from './generated-guide.mjs';
import { resolveLocator } from '../lib/product-map-query.mjs';
import map from '../product-map/approved.json' with { type: 'json' };
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion } from './assistant-service.mjs';
for (const question of ['Como transferir um atendimento?', 'Como criar uma resposta rápida?', 'Como adicionar um contato?', 'Como buscar um contato?', 'Como filtrar contatos?']) {
  test(`procedure inputs are bounded, deduplicated, named and resolvable: ${question}`, async () => {
    const sources = await retrieveContext(root, question, 8, { scope: 'Ajuda e FAQ', procedure: true });
    const context = prepareGuideContext(sources);
    assert.ok(context.steps.length > 0 && context.steps.length <= 12);
    assert.ok(context.elements.length > 0 && context.elements.length <= 500);
    for (const { route, locator } of context.elements) {
      assert.ok(locator.name);
      assert.equal(resolveLocator(map, route, locator).ok, true);
    }
    assert.equal(new Set(context.elements.map(({ route, locator }) => JSON.stringify([route, locator]))).size, context.elements.length);
    const temporary = await mkdtemp(join(tmpdir(), 'procedure-regression-'));
    try {
      let calls = 0;
      // Recorded shape: an explicit no-mapping response is valid output, never a null locator/draft.
      const client = { responses: { create: async (payload) => {
        calls++;
        assert.equal(payload.text.format.name, 'selecao_guia_documentado');
        assert.equal(payload.text.format.strict, true);
        return { status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output_text: JSON.stringify({
          status: 'unavailable', steps: [], unavailableSteps: [context.steps[0].id],
        }) };
      } } };
      const reasons = [];
      assert.equal(await generateGuide(root, question, sources, client, { sessionId: `regression-${question}`, budget: { file: join(temporary, 'budget.json') }, onGeneratedGuideRejected: (r) => reasons.push(r) }), null);
      assert.equal(calls, 1);
      assert.deepEqual(reasons, [{ reason: 'unmapped_procedure', sourceStepIds: [context.steps[0].id] }]);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}
for (const question of ['Como criar uma etiqueta?', 'Como mudar a foto do meu perfil?', 'Como editar um perfil de acesso?']) {
  test(`unsupported session procedure returns honest text without provider: ${question}`, async () => {
    const result = await answerQuestion(root, question, { scope: 'Ajuda e FAQ', sessionId: 'no-procedure', client: { responses: { create: () => { throw Error('provider must not run'); } } } });
    assert.equal(result.generatedGuide, undefined);
    assert.equal(result.found, false);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.steps, []);
  });
}

import { generatedSelectionSchema } from './generated-guide.mjs';
import { parseAssistantRequest, generatedGuideSchema } from '../architecture/conversation-v1.mjs';
test('three new catalog routes are accepted by context and generated contract', () => {
  for (const route of ['/configuracoes/atalhos', '/configuracoes/automacoes', '/configuracoes/motivos']) {
    assert.equal(parseAssistantRequest({ question: 'Como usar?', widgetContext: { route } }).widgetContext.route, route);
    assert.ok(generatedGuideSchema.safeParse({ schemaVersion: 1, guideId: 'gen-0123456789ab', version: 1, mode: 'gerado', transitions: 'explicit', initialStepId: 'passo-1', steps: [{ stepId: 'passo-1', title: 'Abrir tela', text: 'Abra a tela.', route, locator: { kind: 'button', name: 'Abrir' }, next: { outcome: 'complete' } }] }).success);
  }
});
test('structured selection rejects null, fabricated and cross-source identifiers', async () => {
  const sources = await retrieveContext(root, 'Como adicionar um contato?', 8, { scope: 'Ajuda e FAQ', procedure: true });
  const context = prepareGuideContext(sources);
  const schema = generatedSelectionSchema(context);
  for (const elementId of [null, 'fake']) assert.equal(schema.safeParse({ status: 'guide', steps: [{ sourceStepId: 'source-1', elementId }], unavailableSteps: [] }).success, false);
});
test('documented contact operations materialize exact texts and explicit valid graph from selection IDs', async () => {
  const fixtures = [
    ['Como adicionar um contato?', ['Adicionar Contato', 'Nome', 'Salvar']],
    ['Como buscar um contato?', ['Listar Contatos', 'Buscar contato...', 'Limpar filtros']],
    ['Como filtrar contatos?', ['Listar Contatos', 'Tag', 'Buscar contato...']],
  ];
  for (const [question, names] of fixtures) {
    const sources = await retrieveContext(root, question, 8, { scope: 'Ajuda e FAQ', procedure: true });
    const context = prepareGuideContext(sources);
    const temporary = await mkdtemp(join(tmpdir(), 'procedure-valid-'));
    try {
      const client = { responses: { create: async (payload) => ({ status: 'completed', usage: { input_tokens: 1, output_tokens: 1 }, output_text: JSON.stringify(payload.text.format.name === 'seguranca_resposta'
        ? { mentionsSource: false, unsupportedAction: false }
        : { status: 'guide', unavailableSteps: [], steps: context.steps.map((source, i) => ({ sourceStepId: source.id, elementId: context.elements.find((e) => e.locator.name === names[i]).id })) }) }) } };
      const result = await generateGuide(root, question, sources, client, { sessionId: 'documented-contact', budget: { file: join(temporary, 'budget.json') } });
      assert.ok(result.generatedGuide);
      assert.deepEqual(result.generatedGuide.steps.map(({ text }) => text), context.steps.map(({ text }) => text));
      assert.ok(generatedGuideSchema.safeParse(result.generatedGuide).success);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
});
