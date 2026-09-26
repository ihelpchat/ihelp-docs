import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { answerQuestion } from './assistant-service.mjs';
import { isCatalogAction } from './product-actions.mjs';
import { parseGuide, parseAssistantRequest, parseAssistantReply, parseProductAction, resolveGuideId, resolveGuideLink } from '../architecture/conversation-v1.mjs';
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import { validateConversationReply } from '../lib/conversation-contract.ts';

const root = new URL('../', import.meta.url).pathname;
const actions = JSON.parse(await readFile(new URL('../architecture/product-actions.json', import.meta.url), 'utf8'));
const request = {
  question: 'Como criar um chatbot?',
  history: [{ role: 'user', content: 'Quero um robô.' }],
  scope: 'Tudo', page: { path: '/docs/sobre-o-sistema/robo-de-atendimento', title: 'Robô de atendimento' },
  widgetContext: { surface: 'app', route: '/bot', module: 'robots', screen: 'list', role: 'agent', permissions: ['robots.read'], channels: [{ kind: 'whatsapp', state: 'connected' }] },
};
assert.deepEqual(parseAssistantRequest(request).question, request.question, 'pedido montado pela UI passa inteiro');
assert.deepEqual(parseAssistantRequest(request).history, request.history);
assert.deepEqual(parseAssistantRequest({ ...request, guide: { guideId: 'robo-de-atendimento', stepId: 'abrir-robos', version: 1, mode: 'treino', pendingChoice: 'achei' } }).guide.pendingChoice, 'achei');
assert.throws(() => parseAssistantRequest({ ...request, history: [{ ...request.history[0], hidden: true }] }));

const serviceReply = await answerQuestion(root, request.question, { client: { responses: { create: async () => ({
  model: 'gpt-test', output_text: JSON.stringify({ answer: 'Abra Robôs.', sections: [], steps: [], code: null, sources: ['/docs/sobre-o-sistema/robo-de-atendimento'], suggestions: [], resolution: 'complete', found: true }),
}) } } });
assert.ok(serviceReply.steps.length && serviceReply.sources.length, 'fixture gravada pelo serviço tem passos e fontes');
assert.deepEqual(parseAssistantReply(serviceReply).steps, serviceReply.steps, 'resposta real do serviço passa inteira');
assert.deepEqual(validateConversationReply(serviceReply).sources, serviceReply.sources, 'cliente aceita a mesma resposta');
assert.throws(() => parseAssistantReply({ ...serviceReply, unknown: true }));

const aliases = {
  'importar-contatos': { kind: 'navigation', actionId: 'importar-contatos' },
  'abrir-robos': { kind: 'navigation', actionId: 'abrir-robos' },
  'abrir-usuarios': { kind: 'guide', guideId: 'usuario-acesso' },
  'abrir-canais': { kind: 'navigation', actionId: 'abrir-canais' },
  'abrir-campanhas': { kind: 'guide', guideId: 'campanhas' },
  'abrir-departamentos': { kind: 'guide', guideId: 'permissoes-departamentos' },
  'abrir-atendimento': { kind: 'guide', guideId: 'arquivos' },
  'abrir-crm': { kind: 'guide', guideId: 'crm' },
};
for (const [id, expected] of Object.entries(aliases)) {
  assert.deepEqual(resolveGuideLink(id), expected, `alias ${id}`);
  assert.equal(resolveGuideId(id), expected.kind === 'guide' ? expected.guideId : null, `guideId ${id}`);
}
for (const hostile of ['constructor', '__proto__', 'toString']) {
  assert.equal(resolveGuideLink(hostile), null);
  assert.equal(resolveGuideId(hostile), null);
}

const guide = { schemaVersion: 1, guideId: 'reconectar-canal-qr', version: 1, mode: 'real', initialStepId: 'inicio', steps: [
  { stepId: 'inicio', text: 'Abra Canais.', choices: [{ id: 'achei', label: 'Achei', nextStepId: 'fim' }] },
  { stepId: 'fim', text: 'Confira.' },
] };
for (const invalid of [
  { ...guide, initialStepId: 'desconhecido' },
  { ...guide, steps: [guide.steps[0], { ...guide.steps[1], stepId: 'inicio' }] },
  { ...guide, steps: [{ ...guide.steps[0], choices: [guide.steps[0].choices[0], guide.steps[0].choices[0]] }, guide.steps[1]] },
  { ...guide, steps: [{ ...guide.steps[0], choices: [{ ...guide.steps[0].choices[0], condition: 'true' }] }, guide.steps[1]] },
]) assert.throws(() => parseGuide(invalid));

async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const resolved = source.replace("from '../architecture/catalog-action.mjs'", `from '${new URL('../architecture/catalog-action.mjs', import.meta.url).href}'`);
  const compiled = ts.transpileModule(resolved, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { normalizeReply } = await loadTs('../lib/assistant.ts');
const { productActionUrl } = await loadTs('../lib/links.ts');
const good = { id: 'abrir-canais', route: actions['abrir-canais'].route, label: 'Outro' };
const minimal = { id: good.id, route: good.route };
const differentTarget = { ...good, target: 'alvo-inventado' };
const badRoute = { ...good, route: '/atendimento' };
const badHref = { ...good, href: 'https://example.test' };
for (const input of [good, minimal, differentTarget, badRoute, badHref]) {
  const expected = input === good || input === minimal || input === differentTarget ? { id: good.id, ...actions[good.id] } : null;
  assert.deepEqual(resolveCatalogAction(input), expected);
  if (input === badHref) assert.throws(() => parseProductAction(input), 'schema recusa href');
  else assert.deepEqual(parseProductAction(input), expected, 'schema segue o resolver');
  if (expected) assert.deepEqual(parseAssistantReply({ answer: 'Abra Canais.', steps: [{ text: 'Abra Canais.', action: input }] }).steps[0].action, expected, 'resposta v1 normaliza ação');
  assert.equal(isCatalogAction(input), Boolean(expected), 'MCP segue o resolver');
  assert.deepEqual(normalizeReply({ answer: 'Abra Canais.', steps: [{ text: 'Abra Canais.', action: input }] }).steps[0].action, expected ?? undefined, 'UI segue o resolver');
  assert.equal(Boolean(productActionUrl(input)), Boolean(expected), 'link segue o resolver, inclusive campos extras');
}
assert.equal(resolveCatalogAction({ id: 'inventada', route: '/bot' }), null);
execFileSync(process.execPath, ['scripts/generate-conversation-types.mjs', '--check'], { cwd: root, stdio: 'pipe' });
console.log('Correção M5.02: payload real, oito aliases, schema fechado, invariantes e catálogo único passaram.');
