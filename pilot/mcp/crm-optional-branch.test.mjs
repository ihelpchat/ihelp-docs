import assert from 'node:assert/strict';
import { answerQuestion } from './assistant-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const path = '/docs/principais-motivos-de-suporte/crm';
const client = { responses: { create: async () => ({ output_text: JSON.stringify({
  answer: 'Orientação inicial.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true,
}) }) } };
const ask = (question, history = []) => answerQuestion(root, question, { client, history });
const all = await ask('Quero todos os passos: Como criar pipeline no CRM?');
assert.equal(all.steps.length, 16);
const atStep = (index, sourcePath = path) => [
  { role: 'user', content: 'Como criar pipeline no CRM?' },
  { role: 'assistant', content: `1. ${all.steps[index - 1].text}\nFonte usada: ${sourcePath}` },
];
const decision = atStep(8);

for (const phrase of ['não quero automação', 'não quero', 'pular', 'sem automação', 'agora não', 'continuar sem']) {
  const reply = await ask(phrase, decision);
  assert.deepEqual(reply.steps.map(({ text }) => text), [all.steps[15].text], `recusa: ${phrase}`);
  assert.equal(reply.sources[0]?.path, path);
  const done = await ask('concluí', [...decision, { role: 'user', content: phrase },
    { role: 'assistant', content: `${reply.answer}\n1. ${reply.steps[0].text}\nFonte usada: ${path}` }]);
  assert.deepEqual(done.steps, [], `conclusão após recusa: ${phrase}`);
  assert.match(done.answer, /quadro|pipeline/i);
}

for (const phrase of ['quero automação', 'sim']) {
  const reply = await ask(phrase, decision);
  assert.deepEqual(reply.steps.map(({ text }) => text), [all.steps[8].text], `aceite: ${phrase}`);
  const next = await ask('concluí', [...decision, { role: 'user', content: phrase },
    { role: 'assistant', content: `${reply.answer}\n1. ${reply.steps[0].text}\nFonte usada: ${path}` }]);
  assert.deepEqual(next.steps.map(({ text }) => text), [all.steps[9].text], `continuidade: ${phrase}`);
}

const undecided = await ask('concluí', decision);
assert.deepEqual(undecided.steps, []);
assert.match(undecided.answer, /automa[cç][aã]o/i);
assert.match(undecided.answer, /\?/);
const laterDecline = await ask('agora não', [...decision, { role: 'user', content: 'concluí' },
  { role: 'assistant', content: `${undecided.answer}\nFonte usada: ${path}` }]);
assert.deepEqual(laterDecline.steps.map(({ text }) => text), [all.steps[15].text]);

const diagnosis = await ask('não encontrei', decision);
assert.deepEqual(diagnosis.steps, []);
assert.match(diagnosis.answer, /CRM.*menu lateral/i);
const diagnosing = [...decision, { role: 'user', content: 'não encontrei' },
  { role: 'assistant', content: `${diagnosis.answer}\nFonte usada: ${path}` }];
for (const phrase of ['sim', 'não']) {
  const reply = await ask(phrase, diagnosing);
  assert.deepEqual(reply.steps, [], `diagnóstico não escolhe automação: ${phrase}`);
  assert.equal(reply.sources[0]?.path, path, `fonte do diagnóstico: ${phrase}`);
  assert.notEqual(reply.answer, 'Vamos para a próxima ação.');
}
const diagnosisYes = await ask('sim', diagnosing);
const resumeHistory = [...diagnosing, { role: 'user', content: 'sim' },
  { role: 'assistant', content: `${diagnosisYes.answer}\nFonte usada: ${path}` }];
const resume = await ask('sim', resumeHistory);
assert.deepEqual(resume.steps, [], 'confirmação da etapa ainda não escolhe automação');
assert.equal(resume.answer, undecided.answer, 'diagnóstico resolvido reabre o prompt explícito');
const promptedAgain = [...resumeHistory, { role: 'user', content: 'sim' },
  { role: 'assistant', content: `${resume.answer}\nFonte usada: ${path}` }];
assert.deepEqual((await ask('sim', promptedAgain)).steps.map(({ text }) => text), [all.steps[8].text]);
assert.deepEqual((await ask('sem automação', promptedAgain)).steps.map(({ text }) => text), [all.steps[15].text]);

const finalStep = await ask('concluí', atStep(16));
assert.deepEqual(finalStep.steps, []);
assert.match(finalStep.answer, /quadro|pipeline/i);

assert.notDeepEqual((await ask('não', atStep(7))).steps.map(({ text }) => text), [all.steps[15].text]);
for (const [question, slug] of [
  ['Como gerenciar usuário e acesso?', 'usuario-acesso'],
  ['Como reconectar canal pelo QR?', 'reconectar-canal-qr'],
  ['Como comparar API Oficial e QR?', 'api-oficial-qr-coexistencia'],
  ['Como criar uma campanha?', 'campanhas'],
  ['Como configurar permissões e departamentos?', 'permissoes-departamentos'],
  ['Como usar templates?', 'templates'],
  ['Como enviar arquivos?', 'arquivos'],
  ['Como consultar cobrança e plano?', 'cobranca-plano'],
]) {
  const overview = await ask(question);
  const otherPath = `/docs/principais-motivos-de-suporte/${slug}`;
  const history = [{ role: 'user', content: question },
    { role: 'assistant', content: `1. ${overview.steps[0].text}\nFonte usada: ${otherPath}` }];
  const no = await ask('não quero automação', history);
  assert.notEqual(no.sources[0]?.path, path, `intenção preservada: ${slug}`);
  assert.notDeepEqual(no.steps.map(({ text }) => text), [all.steps[15].text], `sem salto: ${slug}`);
}

console.log('CRM: ramo opcional e isolamento de intenções.');
