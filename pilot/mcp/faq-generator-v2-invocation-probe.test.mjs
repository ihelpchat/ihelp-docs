import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import catalog from '../architecture/faq-regua/tarefas-ouro.json' with { type: 'json' };
import { generateFaqV2 } from './faq-generator-v2.mjs';
import { saveJourney } from './journey-service.mjs';
import { configuredJourneyIdentity } from './journey-runtime.mjs';
import { EDITORIAL_CRITERIA } from './faq-editorial-judge.mjs';

// Reproduz offline a leitura real da R3 (deployment 660, QA_TARGET producao): registros válidos com accountProof e
// target 'producao' passam pelo readJourney REAL, que exige prova de conta fresca por leitura. A geração precisa de
// UMA prova fresca por invocação, compartilhada só entre as leituras dessa invocação (inclusive quando rejeita ou
// devolve null: falha fechada, sem nova tentativa, nenhuma jornada vira concluída) e nunca reaproveitada entre
// invocações nem guardada em cache global. readJourney, gate e cache do servidor não mudam.
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const live = { userId: 'u1', companyId: 'c1' };
const tasks = catalog.tarefas.filter(({ modulo }) => modulo === 'robos');
const eligible = tasks.filter(({ id }) => id !== 'robos.publicar_ativar').map(({ id }) => id);
const scores = Object.fromEntries(EDITORIAL_CRITERIA.map((id) => [id, 3]));
const emptyPage = { title: 'Robôs', titleEvidenceIds: [], description: null, descriptionEvidenceIds: [], sections: [] };

async function state(t) {
  const dir = await mkdtemp(join(tmpdir(), 'faq-v2-probe-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ MCP_STATE_DIR: dir, QA_TARGET: 'homolog',
    GUIDE_QA_STAGING_URL: 'https://faq.example.test', GUIDE_QA_ALLOWED_HOSTS: 'faq.example.test',
    GUIDE_QA_AUTHORIZED_EMAIL: 'fixture@example.test', GUIDE_QA_AUTHORIZED_PASSWORD: 'fictional' })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const identity = configuredJourneyIdentity(process.env).credentialHash;
  const journeys = join(dir, 'journeys');
  await mkdir(join(journeys, 'robos'), { recursive: true });
  for (const task of eligible) {
    // Registro concluído e verificado, gravado contra a conta `live`, lido em modo produção (prova fresca por leitura).
    await saveJourney(journeys, 'robos', { task, module: 'robos', status: 'concluída', target: 'producao',
      cacheKey: digest(['registro', task]), configuredIdentityHash: identity, accountProof: digest([live.userId, live.companyId]),
      verification: { confirmed: true, observed: 'ok' }, actions: [], screens: [], before: null, after: null }, []);
  }
  return dir;
}

function probe(behaviour) {
  const log = [];
  const fn = () => { log.push(behaviour.name); return behaviour.result(); };
  return { fn, log };
}
const resolving = (value) => ({ name: 'probe', result: () => Promise.resolve(value) });
const rejecting = () => ({ name: 'probe', result: () => Promise.reject(new Error('login falhou')) });

async function generate(probeAccount) {
  const calls = [];
  const client = { responses: { create: async (request) => {
    calls.push(request);
    const name = request.text.format.name;
    let value = emptyPage;
    if (name === 'faq_facts_v2') value = { claims: JSON.parse(request.input[1].content).claims
      .map((claim) => ({ id: claim.id, status: 'sustentada', evidenceIds: ['F1'], reason: '', sourceMention: false })) };
    if (name === 'faq_editorial_v2') value = { proposito: 'pagina_inteira', notas: scores, defeitosGraves: [],
      naoVerificaveis: [], comentario: 'Texto claro.' };
    return { status: 'completed', output_text: JSON.stringify(value), usage: { input_tokens: 10, output_tokens: 5 } };
  } } };
  const result = await generateFaqV2(root, 'robos', { client, probeAccount,
    contextLoader: async () => ({ screenFacts: [{ text: 'Criar robô; Título do Robô; Salvar.', kind: 'field' }] }),
    businessLoader: async () => [] });
  const draft = calls.find((call) => call.text.format.name === 'faq_page_v2');
  const plan = JSON.parse(draft.input[1].content[0].text).plan.tasks;
  return { result, completed: plan.filter(({ status }) => status === 'concluída').map(({ id }) => id) };
}

test('mesma invocação, seis jornadas elegíveis em modo produção: uma única prova fresca, todas verificadas', async (t) => {
  await state(t);
  const { fn, log } = probe(resolving(live));
  const { result, completed } = await generate(fn);
  assert.deepEqual(completed, eligible);
  assert.deepEqual(result.reviewTasks, ['robos.publicar_ativar']);
  assert.equal(log.length, 1, 'uma prova fresca por invocação, compartilhada entre as leituras');
});

test('duas invocações com a mesma função de prova: uma prova fresca por invocação, sem reaproveitar a anterior', async (t) => {
  await state(t);
  const { fn, log } = probe(resolving(live));
  const first = await generate(fn);
  const second = await generate(fn);
  assert.deepEqual(first.completed, eligible);
  assert.deepEqual(second.completed, eligible);
  assert.equal(log.length, 2, 'cada invocação começa com prova nova');
});

for (const [label, behaviour] of [['rejeitada', rejecting()], ['nula', resolving(null)],
  ['de outra conta', resolving({ userId: 'u2', companyId: 'c1' })]]) {
  test(`prova ${label}: compartilhada na invocação, falha fechada, sem nova tentativa e nenhuma jornada concluída`, async (t) => {
    await state(t);
    const { fn, log } = probe(behaviour);
    const { result, completed } = await generate(fn);
    assert.deepEqual(completed, []);
    assert.deepEqual(result.reviewTasks, tasks.map(({ id }) => id));
    assert.equal(log.length, 1, 'resultado inválido é compartilhado; não há nova tentativa');
  });
}

test('a prova válida de uma invocação não vale para a invocação seguinte (sem cache entre requisições)', async (t) => {
  await state(t);
  const ok = probe(resolving(live));
  const { completed } = await generate(ok.fn);
  assert.deepEqual(completed, eligible);
  const failing = probe(rejecting());
  const second = await generate(failing.fn);
  assert.deepEqual(second.completed, []);
  assert.equal(failing.log.length, 1);
  assert.equal(ok.log.length, 1);
});

test('prova que lança de forma síncrona: memoizada como rejeição, sem nova tentativa, nenhuma jornada concluída', async (t) => {
  await state(t);
  const log = [];
  const fn = () => { log.push('probe'); throw new Error('falha síncrona'); };
  const { result, completed } = await generate(fn);
  assert.deepEqual(completed, []);
  assert.deepEqual(result.reviewTasks, tasks.map(({ id }) => id));
  assert.equal(log.length, 1, 'throw síncrono entra na promessa compartilhada; não é repetido por registro');
});

test('cada registro continua comparado com a prova: registro de outra conta na mesma invocação não conclui', async (t) => {
  const dir = await state(t);
  // robos.buscar regravado com accountProof de outra conta; o ponteiro .latest passa a apontar para ele.
  await saveJourney(join(dir, 'journeys'), 'robos', { task: 'robos.buscar', module: 'robos', status: 'concluída',
    target: 'producao', cacheKey: digest(['registro-outra-conta', 'robos.buscar']),
    configuredIdentityHash: configuredJourneyIdentity(process.env).credentialHash, accountProof: digest(['u9', 'c9']),
    verification: { confirmed: true, observed: 'ok' }, actions: [], screens: [], before: null, after: null }, []);
  const { fn, log } = probe(resolving(live));
  const { result, completed } = await generate(fn);
  assert.deepEqual(completed, eligible.filter((id) => id !== 'robos.buscar'));
  assert.ok(result.reviewTasks.includes('robos.buscar'), 'jornada de outra conta fica sem jornada');
  assert.equal(log.length, 1, 'a mesma prova serve para comparar cada registro individualmente');
});
