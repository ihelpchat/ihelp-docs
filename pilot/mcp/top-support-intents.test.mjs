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
  ['Como consultar cobrança e plano?', 'cobranca-plano', 'billing', 'abrir-cobranca', 2, /Plano e cobrança/],
  ['Como gerenciar usuário e acesso?', 'usuario-acesso', 'manage_users', 'abrir-usuarios', 5, /Usuários/],
  ['Como reconectar canal pelo QR?', 'reconectar-canal-qr', 'connect_channel', 'abrir-canais', 5, /Canais/],
  ['Como comparar API Oficial e QR?', 'api-oficial-qr-coexistencia', 'connect_channel', 'abrir-canais', 3, /Canais/],
  ['Como criar uma campanha?', 'campanhas', 'campaigns', 'abrir-campanhas', 7, /Campanhas/],
  ['Como configurar permissões e departamentos?', 'permissoes-departamentos', 'departments', 'abrir-departamentos', 5, /Departamentos/],
  ['Como usar templates?', 'templates', 'templates', 'abrir-canais', 4, /Templates/],
  ['Como enviar arquivos?', 'arquivos', 'files', 'abrir-atendimento', 3, /Atendimento/],
  ['Como criar pipeline no CRM?', 'crm', 'crm', 'abrir-crm', 6, /CRM/],
];
const client = { responses: { create: async () => ({ model: 'fixture', output_text: JSON.stringify({
  answer: 'Orientação inicial.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true,
}) }) } };
const ask = (question, options = {}) => answerQuestion(root, question, { client, ...options });

for (const [question, slug, intent, action, count, moduleName] of cases) {
  const path = `/docs/principais-motivos-de-suporte/${slug}`;
  const raw = await readFile(new URL(`../content/docs${path}.mdx`, import.meta.url), 'utf8');
  assert.match(raw, /## Pr[eé]-requisitos/);
  assert.match(raw, /## Como confirmar/);
  assert.match(raw, /## Se n[aã]o funcionar/);
  assert.doesNotMatch(raw, /<VideoEmbed|<TutorialCard/);
  const overview = await ask(question);
  assert.equal(overview.sources[0]?.path, path, question);
  assert.equal(overview.resolution, ['campanhas', 'permissoes-departamentos', 'crm'].includes(slug) ? 'complete' : 'partial', question);
  assert.ok(overview.steps.length >= 1 && overview.steps.length <= 3, question);
  assert.equal(overview.steps[0].action?.id, action, question);
  assert.equal(overview.steps[0].action?.route.startsWith('/'), true);
  assert.equal(overview.sources[0]?.media, undefined, 'nenhum vídeo automático');
  assert.doesNotMatch(JSON.stringify(overview), /[+][0-9]{10,}|\b(?:sk-[a-z0-9]+|token)\b|<VideoEmbed/i);
  const hinted = await ask(question, { widgetContext: { surface: 'app', module: 'robots', plan: 'expired' } });
  assert.deepEqual(hinted.steps, overview.steps, `hint não suprime guia: ${question}`);
  assert.deepEqual(hinted.sources, overview.sources, `hint não troca fonte: ${question}`);
  const all = await ask(`Quero todos os passos: ${question}`);
  assert.equal(all.steps.length, count, `todos os passos devem estar completos: ${question}`);
  assert.deepEqual(all.steps[0].action, overview.steps[0].action, question);
  assert.equal(all.sources[0]?.path, path, question);
  const expectedImage = slug === 'campanhas' ? '/img/help/hlPVE1pICUAOU19G5Kgc.png'
    : slug === 'arquivos' ? '/img/help/GfhFEXvIay0CqgN2dth6.png' : undefined;
  assert.equal(all.steps.flatMap((step) => step.image ? [step.image.src] : [])[0], expectedImage, `screenshot da fonte: ${question}`);
  for (const step of all.steps) if (step.image) assert.ok(step.image.alt.length >= 20);
  const history = [
    { role: 'user', content: question },
    { role: 'assistant', content: `${overview.answer}\n1. ${overview.steps[0].text}\nFonte usada: ${path}` },
  ];
  const next = await ask('sim, pode me guiar', { history });
  assert.equal(next.steps.length, 1, question);
  const walk = [...history];
  for (let index = 1; index < count; index++) {
    walk.push({ role: 'user', content: 'Concluí este passo' });
    const reply = await ask('Concluí este passo', { history: walk });
    assert.deepEqual(reply.steps.map(({ text }) => text), [all.steps[index].text], `ação ${index + 1}: ${question}`);
    walk.push({ role: 'assistant', content: `${reply.answer}\n1. ${reply.steps[0].text}\nFonte usada: ${path}` });
  }
  const lateStuck = await ask('não encontrei', { history: walk });
  assert.match(lateStuck.answer, moduleName, `diagnóstico após várias etapas: ${question}`);
  const lateEscalation = await ask('preciso de ajuda', { history: [...walk, { role: 'user', content: 'não encontrei' }, { role: 'assistant', content: `${lateStuck.answer}\nFonte usada: ${path}` }] });
  assert.equal(lateEscalation.escalation?.intent, intent, `intenção preservada até o fim: ${question}`);
  const stuck = await ask('não encontrei', { history });
  assert.equal(stuck.steps.length, 0);
  assert.equal(stuck.sources[0]?.path, path);
  assert.doesNotMatch(stuck.answer, /Robôs/, question);
  assert.match(stuck.answer, moduleName, `diagnóstico do módulo: ${question}`);
  const escalated = await ask('preciso de ajuda', { history: [...history, { role: 'user', content: 'não encontrei' }, { role: 'assistant', content: `${stuck.answer}\nFonte usada: ${path}` }] });
  assert.equal(escalated.escalation?.intent, intent, question);
  const message = supportMessageFor(escalated);
  assert.match(message, /Intenção:|Diagnóstico inicial:|Tentativas:/);
  assert.doesNotMatch(message, /\{|\}|documented_guide|reported_stuck|sk-|token/i);
}
console.log('Nove intenções de suporte: fluxo answerQuestion completo.');
