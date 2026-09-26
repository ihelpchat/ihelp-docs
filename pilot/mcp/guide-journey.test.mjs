import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import guideIds from '../architecture/guide-ids.json' with { type: 'json' };

const root = await mkdtemp(join(tmpdir(), 'guide-journey-'));
const directory = join(root, 'content/docs');
await mkdir(directory, { recursive: true });
for (const guideId of guideIds) {
  const choice = guideId === 'reconectar-canal-qr';
  await writeFile(join(directory, `${guideId}.mdx`), `---
title: Guia ${guideId}
guide:
  schemaVersion: 1
  guideId: ${guideId}
  version: 1
  mode: real
  initialStepId: inicio
  steps:
    - stepId: inicio
      text: Abra a primeira tela.
${choice ? '' : '      actionId: abrir-canais\n'}
    - stepId: ${choice ? 'escolha' : 'final'}
      text: ${choice ? 'Escolha uma opção.' : 'Confira o resultado.'}
${choice ? `      choices:
        - id: android
          label: Usar Android
          nextStepId: android
        - id: iphone
          label: Usar iPhone
          nextStepId: iphone
    - stepId: android
      text: Abra o menu Android.
    - stepId: iphone
      text: Abra o menu iPhone.
    - stepId: confirmar
      text: Confirme a conexão.
      actionId: abrir-canais
` : ''}---
Conteúdo de teste.
`);
}

let providerCalls = 0;
const provider = createServer((_request, response) => {
  providerCalls += 1;
  response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
process.env.PORT = '0';
process.env.DOCS_ROOT = root;
process.env.OPENAI_API_KEY = 'fixture';
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1`;
process.env.SESSION_EVENTS_FILE = join(root, 'sessions.jsonl');
process.env.NEXT_PUBLIC_ASSISTANT_URL = 'http://127.0.0.1:0/assistant';
const { httpServer } = await import('./http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
process.env.NEXT_PUBLIC_ASSISTANT_URL = `http://127.0.0.1:${httpServer.address().port}/assistant`;
const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../lib/assistant.ts', import.meta.url), 'utf8'));
const compiled = ts.transpileModule(source.replace("from '../architecture/catalog-action.mjs'", `from '${new URL('../architecture/catalog-action.mjs', import.meta.url).href}'`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildAssistantRequest, requestAnswer, normalizeReply, supportMessageFor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
let requests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => originalFetch(input, {
  ...init, headers: { ...init?.headers, 'X-Forwarded-For': `198.51.${Math.floor(requests / 200)}.${requests % 200 + 1}` },
});
async function post(question, priorReply, initialGuide) {
  const request = buildAssistantRequest(question, priorReply, {
    sessionId: `journey-${++requests}`, origin: 'faq', ...(initialGuide ? { guide: initialGuide } : {}),
  });
  return requestAnswer(request);
}
const startState = (guideId, extra = {}) => ({ guideId, stepId: 'inicio', version: 1, mode: 'real', ...extra });
const assertStep = (reply, guideId) => {
  const published = guideId === 'reconectar-canal-qr'
    ? { inicio: { text: 'Abra a primeira tela.' }, escolha: { text: 'Escolha uma opção.', choices: [{ id: 'android', label: 'Usar Android' }, { id: 'iphone', label: 'Usar iPhone' }] }, android: { text: 'Abra o menu Android.' }, iphone: { text: 'Abra o menu iPhone.' }, confirmar: { text: 'Confirme a conexão.', actionId: 'abrir-canais' } }
    : { inicio: { text: 'Abra a primeira tela.', actionId: 'abrir-canais' }, final: { text: 'Confira o resultado.' } };
  const step = published[reply.guide.stepId];
  assert.ok(step, `${guideId}: passo publicado`);
  assert.equal(reply.steps[0].text, step.text);
  assert.deepEqual(reply.steps[0].action, step.actionId ? { id: 'abrir-canais', label: 'Abrir a tela Canais', route: '/configuracoes/channel' } : undefined);
  if (step.choices) {
    assert.deepEqual(reply.suggestions, step.choices.map((choice) => choice.label));
    assert.deepEqual(reply.guideChoices, step.choices);
  }
};

try {
  for (const guideId of guideIds) {
    const initial = await post('Começar', undefined, startState(guideId));
    if (!initial.guide) {
      try { await post('Concluí este passo', initial); } catch {}
      assert.equal(providerCalls, 0, `${guideId}: clique sem guide caiu no provider`);
    }
    assert.equal(initial.guide.stepId, 'inicio');
    assert.notEqual(initial.resolution, 'complete', `${guideId}: início não conclui o guia`);
    const queue = [{ reply: initial, depth: 0 }];
    const visited = new Set();
    let completed = false;
    while (queue.length) {
      const { reply, depth } = queue.shift();
      if (depth > 4 || !reply.guide) continue;
      const key = `${reply.guide.stepId}:${reply.answer}`;
      if (visited.has(key)) continue;
      visited.add(key);
      assertStep(reply, guideId);
      const offered = [...reply.suggestions, ...(reply.resolution === 'complete' ? [] : ['Falar com uma pessoa'])];
      for (const option of offered) {
        const next = await post(option, reply);
        if (option !== 'Preciso de ajuda') assert.notDeepEqual(next, reply, `${guideId}/${reply.guide.stepId}: ${option} não avançou`);
        assert.equal(providerCalls, 0, 'guia nunca chama o provider');
        if (option === 'Falar com uma pessoa' || option === 'Deu certo? Não') {
          assert.equal(next.resolution, 'partial');
          assert.equal(next.escalation?.guideId, guideId);
          assert.equal(next.escalation?.stepId, reply.guide.stepId);
          const link = `https://wa.me/551730422307?text=${encodeURIComponent(supportMessageFor(normalizeReply(next)))}`;
          assert.match(decodeURIComponent(new URL(link).searchParams.get('text')), new RegExp(`${guideId}.*${reply.guide.stepId}`, 's'));
        } else if (next.resolution === 'complete') {
          assert.equal(option, 'Deu certo? Sim', `${guideId}: conclusão prematura`);
          assert.equal(reply.guide.stepId, guideId === 'reconectar-canal-qr' ? 'confirmar' : 'final', `${guideId}: conclusão só no passo terminal`);
          completed = true;
        } else if (next.guide) queue.push({ reply: next, depth: depth + 1 });
      }
    }
    assert.equal(completed, true, `${guideId}: confirmação final não foi oferecida`);
    const invalid = await post('Avançar', undefined, startState(guideId, { version: 2 }));
    assert.ok(invalid.suggestions.includes('Recomeçar'));
    const restarted = await post('Recomeçar', undefined, startState(guideId, { version: 2, stateToken: 'invalid' }));
    assert.equal(restarted.guide.stepId, 'inicio', `${guideId}: reinício precisa dispensar token inválido`);
    assert.ok(restarted.guide.stateToken);
  }
  assert.equal(providerCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  await rm(root, { recursive: true, force: true });
}
