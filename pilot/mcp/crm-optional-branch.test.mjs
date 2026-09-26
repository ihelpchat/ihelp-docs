import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { answerQuestion, retrieveContext } from './assistant-service.mjs';
import { freeAnswerClient } from './fixtures/free-answer-client.mjs';

const root = new URL('../', import.meta.url).pathname;
const path = '/docs/principais-motivos-de-suporte/crm';
const client = freeAnswerClient({ responses: { create: async () => ({ output_text: JSON.stringify({
  answer: 'Orientação inicial.', sections: [], steps: [], code: null, sources: [], suggestions: [], resolution: 'complete', found: true,
}) }) } });
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
assert.deepEqual(resume.suggestions, ['Quero automação', 'Sem automação']);
const promptedAgain = [...resumeHistory, { role: 'user', content: 'sim' },
  { role: 'assistant', content: `${resume.answer}\nFonte usada: ${path}` }];
assert.deepEqual((await ask('sim', promptedAgain)).steps.map(({ text }) => text), [all.steps[8].text]);
assert.deepEqual((await ask('sem automação', promptedAgain)).steps.map(({ text }) => text), [all.steps[15].text]);

const blocked = await ask('não', diagnosing);
assert.deepEqual(blocked.steps, []);
assert.equal(blocked.sources[0]?.path, path);
assert.match(blocked.answer, /diga [“"']?encontrei[”"']?/i);
assert.match(blocked.answer, /aviso/i);
const blockedHistory = [...diagnosing, { role: 'user', content: 'não' },
  { role: 'assistant', content: `${blocked.answer}\nFonte usada: ${path}` }];
for (const phrase of ['encontrei', 'consegui', 'concluí', 'agora apareceu']) {
  const recovered = await ask(phrase, blockedHistory);
  assert.deepEqual(recovered.steps, [], `retomada sem reinício: ${phrase}`);
  assert.equal(recovered.sources[0]?.path, path, `fonte preservada: ${phrase}`);
  assert.equal(recovered.answer, undecided.answer, `prompt explícito: ${phrase}`);
  const recoveryHistory = [...blockedHistory, { role: 'user', content: phrase },
    { role: 'assistant', content: `${recovered.answer}\nFonte usada: ${path}` }];
  assert.deepEqual((await ask('sim', recoveryHistory)).steps.map(({ text }) => text), [all.steps[8].text], `ramo sim: ${phrase}`);
  assert.deepEqual((await ask('não', recoveryHistory)).steps.map(({ text }) => text), [all.steps[15].text], `ramo não: ${phrase}`);
}
for (const phrase of ['sim', 'não']) {
  const ambiguous = await ask(phrase, blockedHistory);
  assert.deepEqual(ambiguous.steps, [], `resposta ambígua no bloqueio: ${phrase}`);
  assert.equal(ambiguous.answer, blocked.answer, `clarificação preserva estado: ${phrase}`);
  assert.equal(ambiguous.sources[0]?.path, path);
  const stillBlocked = [...blockedHistory, { role: 'user', content: phrase },
    { role: 'assistant', content: `${ambiguous.answer}\nFonte usada: ${path}` }];
  assert.equal((await ask('encontrei', stillBlocked)).answer, undecided.answer, `recuperação após ambiguidade: ${phrase}`);
}

const isolated = await mkdtemp(join(tmpdir(), 'ihelp-crm-branch-'));
try {
  const guidePath = join(isolated, 'content/docs/docs/principais-motivos-de-suporte/crm.mdx');
  await mkdir(join(isolated, 'content/docs/docs/principais-motivos-de-suporte'), { recursive: true });
  const originalGuide = await readFile(new URL('../content/docs/docs/principais-motivos-de-suporte/crm.mdx', import.meta.url), 'utf8');
  for (const invalid of ['8:8:16', '8:9:17', '0:9:16', 'xyz', '-1:9:16']) {
    await writeFile(guidePath, originalGuide.replace('assistantOptionalBranch: "8:9:16"', `assistantOptionalBranch: "${invalid}"`));
    const [source] = await retrieveContext(isolated, 'Como criar pipeline no CRM?');
    assert.equal(source.optionalBranch, null, `metadado inválido ignorado: ${invalid}`);
  }
} finally {
  await rm(isolated, { recursive: true, force: true });
}

const finalStep = await ask('concluí', atStep(16));
assert.deepEqual(finalStep.steps, []);
assert.match(finalStep.answer, /quadro|pipeline/i);

assert.notDeepEqual((await ask('não', atStep(7))).steps.map(({ text }) => text), [all.steps[15].text]);
assert.notEqual((await ask('encontrei', atStep(7))).answer, undecided.answer, 'retomada não ativa fora da etapa 8');
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
  const recoveryOutsideCrm = await ask('encontrei', history);
  assert.notEqual(recoveryOutsideCrm.sources[0]?.path, path, `retomada isolada: ${slug}`);
  assert.notEqual(recoveryOutsideCrm.answer, undecided.answer, `sem prompt CRM: ${slug}`);
  const otherDiagnosis = await ask('não encontrei', history);
  const afterDiagnosis = await ask('sim', [...history, { role: 'user', content: 'não encontrei' },
    { role: 'assistant', content: `${otherDiagnosis.answer}\nFonte usada: ${otherPath}` }]);
  assert.notEqual(afterDiagnosis.sources[0]?.path, path, `diagnóstico mantém intenção: ${slug}`);
  assert.notDeepEqual(afterDiagnosis.steps.map(({ text }) => text), [all.steps[8].text], `sem ramo CRM: ${slug}`);
}

console.log('CRM: ramo opcional e isolamento de intenções.');
