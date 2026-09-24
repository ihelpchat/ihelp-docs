import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { answerQuestion } from './assistant-service.mjs';

const uiSource = await readFile(new URL('../lib/assistant.ts', import.meta.url), 'utf8');
const actions = await readFile(new URL('../architecture/product-actions.json', import.meta.url), 'utf8');
const compiled = ts.transpileModule(uiSource.replace("import allowedActions from '@/architecture/product-actions.json';", `const allowedActions = ${actions};`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { supportMessageFor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const root = new URL('../', import.meta.url).pathname;
const cases = [
  ['Como consultar cobrança e plano?', 'cobranca-plano', 'billing', 'abrir-cobranca'],
  ['Como gerenciar usuário e acesso?', 'usuario-acesso', 'manage_users', 'abrir-usuarios'],
  ['Como reconectar canal pelo QR?', 'reconectar-canal-qr', 'connect_channel', 'abrir-canais'],
  ['Como comparar API Oficial e QR?', 'api-oficial-qr-coexistencia', 'connect_channel', 'abrir-canais'],
  ['Como criar uma campanha?', 'campanhas', 'campaigns', 'abrir-campanhas'],
  ['Como configurar permissões e departamentos?', 'permissoes-departamentos', 'departments', 'abrir-departamentos'],
  ['Como usar templates?', 'templates', 'templates', 'abrir-canais'],
  ['Como enviar arquivos?', 'arquivos', 'files', 'abrir-atendimento'],
  ['Como criar pipeline no CRM?', 'crm', 'crm', 'abrir-crm'],
];
const client = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
  answer: 'Orientação inicial.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true,
}) }) } };
const ask = (question, options = {}) => answerQuestion(root, question, { client, ...options });

for (const [question, slug, intent, action] of cases) {
  const path = `/docs/principais-motivos-de-suporte/${slug}`;
  const raw = await readFile(new URL(`../content/docs${path}.mdx`, import.meta.url), 'utf8');
  assert.match(raw, /## Pr[eé]-requisitos/);
  assert.match(raw, /## Como confirmar/);
  assert.match(raw, /## Se n[aã]o funcionar/);
  assert.doesNotMatch(raw, /<VideoEmbed|<TutorialCard/);
  const overview = await ask(question);
  assert.equal(overview.sources[0]?.path, path, question);
  assert.ok(overview.steps.length >= 1 && overview.steps.length <= 3, question);
  assert.equal(overview.steps[0].action?.id, action, question);
  assert.equal(overview.steps[0].action?.route.startsWith('/'), true);
  assert.doesNotMatch(JSON.stringify(overview), /[+][0-9]{10,}|\b(?:sk-[a-z0-9]+|token)\b|<VideoEmbed/i);
  const hinted = await ask(question, { widgetContext: { surface: 'app', module: 'robots', plan: 'expired' } });
  assert.deepEqual(hinted.steps, overview.steps, `hint não suprime guia: ${question}`);
  assert.deepEqual(hinted.sources, overview.sources, `hint não troca fonte: ${question}`);
  const all = await ask(`Quero todos os passos: ${question}`);
  assert.ok(all.steps.length >= overview.steps.length, question);
  assert.deepEqual(all.steps[0].action, overview.steps[0].action, question);
  assert.equal(all.sources[0]?.path, path, question);
  const history = [
    { role: 'user', content: question },
    { role: 'assistant', content: `${overview.answer}\n1. ${overview.steps[0].text}\nFonte usada: ${path}` },
  ];
  const next = await ask('sim, pode me guiar', { history });
  assert.equal(next.steps.length, 1, question);
  const stuck = await ask('não encontrei', { history });
  assert.equal(stuck.steps.length, 0);
  assert.equal(stuck.sources[0]?.path, path);
  assert.doesNotMatch(stuck.answer, /Robôs/, question);
  const escalated = await ask('preciso de ajuda', { history: [...history, { role: 'user', content: 'não encontrei' }, { role: 'assistant', content: `${stuck.answer}\nFonte usada: ${path}` }] });
  assert.equal(escalated.escalation?.intent, intent, question);
  const message = supportMessageFor(escalated);
  assert.match(message, /Intenção:|Diagnóstico inicial:|Tentativas:/);
  assert.doesNotMatch(message, /\{|\}|documented_guide|reported_stuck|sk-|token/i);
}
console.log('Nove intenções de suporte: fluxo answerQuestion completo.');
