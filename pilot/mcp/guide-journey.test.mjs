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
    - stepId: ${choice ? 'escolha' : 'final'}
      text: ${choice ? 'Escolha uma opção.' : 'Confira o resultado.'}
${choice ? `      choices:
        - id: android
          label: Android
          nextStepId: android
        - id: iphone
          label: iPhone
          nextStepId: iphone
    - stepId: android
      text: Abra o menu Android.
    - stepId: iphone
      text: Abra o menu iPhone.
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
const { httpServer } = await import('./http.mjs');
if (!httpServer.listening) await once(httpServer, 'listening');
const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../lib/assistant.ts', import.meta.url), 'utf8'));
const compiled = ts.transpileModule(source.replace("from '../architecture/catalog-action.mjs'", `from '${new URL('../architecture/catalog-action.mjs', import.meta.url).href}'`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeReply, supportMessageFor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
let requests = 0;
async function post(question, guide) {
  const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/assistant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.${Math.floor(requests / 200)}.${requests % 200 + 1}` },
    body: JSON.stringify({ question, guide, sessionId: `journey-${++requests}` }),
  });
  if (response.status !== 200) assert.fail(`${question}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}
const startState = (guideId, extra = {}) => ({ guideId, stepId: 'inicio', version: 1, mode: 'real', ...extra });
const optionState = (reply, option) => {
  const guide = { ...reply.guide };
  if (reply.suggestions.includes(option) && !['Concluí este passo', 'Preciso de ajuda', 'Deu certo? Sim', 'Deu certo? Não', 'Voltar'].includes(option)) {
    guide.choiceId = option.toLowerCase();
  }
  return guide;
};

try {
  for (const guideId of guideIds) {
    const initial = await post('Começar', startState(guideId));
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
      const offered = [...reply.suggestions, ...(reply.resolution === 'complete' ? [] : ['Falar com uma pessoa'])];
      for (const option of offered) {
        const next = await post(option, optionState(reply, option));
        if (option !== 'Preciso de ajuda') assert.notDeepEqual(next, reply, `${guideId}/${reply.guide.stepId}: ${option} não avançou`);
        assert.equal(providerCalls, 0, 'guia nunca chama o provider');
        if (option === 'Falar com uma pessoa' || option === 'Deu certo? Não') {
          assert.equal(next.resolution, 'partial');
          assert.equal(next.escalation.guideId, guideId);
          assert.equal(next.escalation.stepId, reply.guide.stepId);
          const link = `https://wa.me/551730422307?text=${encodeURIComponent(supportMessageFor(normalizeReply(next)))}`;
          assert.match(decodeURIComponent(new URL(link).searchParams.get('text')), new RegExp(`${guideId}.*${reply.guide.stepId}`, 's'));
        } else if (next.resolution === 'complete') {
          assert.equal(option, 'Deu certo? Sim', `${guideId}: conclusão prematura`);
          assert.notEqual(reply.guide.stepId, 'inicio', `${guideId}: primeiro passo concluiu`);
          completed = true;
        } else if (next.guide) queue.push({ reply: next, depth: depth + 1 });
      }
    }
    assert.equal(completed, true, `${guideId}: confirmação final não foi oferecida`);
    const invalid = await post('Avançar', startState(guideId, { version: 2 }));
    assert.ok(invalid.suggestions.includes('Recomeçar'));
    const restarted = await post('Recomeçar', startState(guideId, { version: 2, stateToken: 'invalid' }));
    assert.equal(restarted.guide.stepId, 'inicio', `${guideId}: reinício precisa dispensar token inválido`);
    assert.ok(restarted.guide.stateToken);
  }
  assert.equal(providerCalls, 0);
} finally {
  await new Promise((resolve) => httpServer.close(resolve));
  await new Promise((resolve) => provider.close(resolve));
  await rm(root, { recursive: true, force: true });
}
