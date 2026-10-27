import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import catalog from '../architecture/faq-regua/tarefas-ouro.json' with { type: 'json' };
import { generateFaqV2 } from './faq-generator-v2.mjs';
import { EDITORIAL_CRITERIA } from './faq-editorial-judge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scores = Object.fromEntries(EDITORIAL_CRITERIA.map((id) => [id, 3]));
const editorial = { proposito: 'pagina_inteira', notas: scores, defeitosGraves: [],
  naoVerificaveis: [], comentario: 'Texto claro.' };
const instruction = 'Clique em Criar robô, preencha o Título do Robô e clique em Salvar.';
const contextText = 'O campo Título do Robô identifica o cadastro na lista.';
const tasks = (area) => catalog.tarefas.filter(({ modulo }) => modulo === area);
const pageFor = (area = 'robos') => ({ title: area === 'robos' ? 'Robôs' : 'Contatos',
  titleEvidenceIds: ['F1'], description: null, descriptionEvidenceIds: [],
  sections: tasks(area).map(({ id, tarefa }) => ({ heading: tarefa, headingEvidenceIds: ['F1'],
    taskId: id, units: [{ text: contextText, kind: 'contexto', evidenceIds: ['F1'] }] })) });
const usage = { input_tokens: 100, output_tokens: 20 };
const cost = (calls) => calls * 0.002;

// All loaders and the Responses client are in-memory. The only file is a synthetic image.
async function fixture(t, { area = 'robos', page = pageFor(area), rewrite = page,
  factual, response, screenshot = false, completed = false, model = 'gpt-6-astra' } = {}) {
  const state = await mkdtemp(join(tmpdir(), 'faq-v2-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({ MCP_STATE_DIR: state, QA_TARGET: 'homolog',
    GUIDE_QA_STAGING_URL: 'https://faq.example.test', GUIDE_QA_ALLOWED_HOSTS: 'faq.example.test',
    GUIDE_QA_AUTHORIZED_EMAIL: 'fixture@example.test', GUIDE_QA_AUTHORIZED_PASSWORD: 'fictional' }))
    {
      const previous = process.env[name];
      process.env[name] = value;
      t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
    }
  const screenshotId = 'a'.repeat(64);
  if (screenshot) {
    await mkdir(join(state, 'journeys', area), { recursive: true });
    await writeFile(join(state, 'journeys', area, `${screenshotId}.png`), Buffer.from('synthetic image'));
  }
  const calls = [];
  const client = { responses: { create: async (request) => {
    calls.push(request);
    const name = request.text.format.name;
    let value;
    if (name === 'faq_page_v2') value = page;
    else if (name === 'faq_rewrite_v2') value = rewrite;
    else if (name === 'faq_editorial_v2') value = editorial;
    else if (name === 'faq_facts_v2') {
      const payload = JSON.parse(request.input[1].content);
      value = { claims: payload.claims.map((claim) => ({ id: claim.id, status: 'sustentada',
        evidenceIds: ['F1'], reason: '', sourceMention: false, ...(factual?.(claim, payload, request) ?? {}) })) };
    } else assert.fail(`unexpected request ${name}`);
    return response?.(request, value, calls.length) ?? {
      status: 'completed', output_text: JSON.stringify(value), usage,
    };
  } } };
  let result;
  await assert.doesNotReject(async () => { result = await generateFaqV2(root, area, { client, model,
    journeyReader: async ({ task }) => ({ task, status: completed || screenshot ? 'concluída' : 'bloqueada',
      verification: { confirmed: true }, screens: screenshot ? [{ screenshotId, title: 'Robôs' }] : [] }),
    contextLoader: async () => ({ screenFacts: [{ text: 'Criar robô; Título do Robô; Salvar.', kind: 'field' }] }),
    businessLoader: async () => [],
  }); });
  return { result, calls, screenshotId };
}

for (const linked of [true, false]) test(`caller real entrega metadados e pauta ao juiz: contexto procedural, vínculo=${linked}`, async (t) => {
  const page = pageFor();
  const section = page.sections.find(({ taskId }) => taskId === 'robos.criar');
  if (linked) section.units[0].text = instruction;
  else page.sections.push({ ...section, taskId: null, units: [{ ...section.units[0], text: instruction }] });
  const captured = [];
  const { result, calls } = await fixture(t, { page, factual: (claim, payload, request) => {
    captured.push({ claim, payload, request });
    // Deliberately permissive if metadata is lost: the old adapter approves this bypass.
    if (claim.text === instruction && claim.kind === 'contexto' && claim.field?.includes('.units[')
      && payload.plan?.tasks.some(({ id, status }) => id === 'robos.criar' && status === 'sem jornada'))
      return { status: 'a confirmar', reason: 'Procedimento sem jornada concluída.' };
  } });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.corrections, 1);
  assert.equal(result.mdx, undefined);
  const sent = captured.filter(({ claim }) => claim.text === instruction);
  assert.equal(sent.length, 2);
  for (const { claim, payload, request } of sent) {
    assert.equal(claim.kind, 'contexto');
    assert.equal(claim.taskId, linked ? 'robos.criar' : null);
    assert.equal(claim.taskStatus, linked ? 'sem jornada' : 'sem vínculo');
    assert.ok(claim.field.includes('.units['));
    assert.equal(payload.plan.tasks.find(({ id }) => id === 'robos.criar').status, 'sem jornada');
    assert.match(request.input[0].content, /independentemente.*kind/iu);
    assert.match(request.input[0].content, /sem vínculo/u);
  }
  assert.equal(calls.filter(({ text }) => text.format.name === 'faq_rewrite_v2').length, 1);
  assert.deepEqual(result.usage, { inputTokens: 1000, outputTokens: 200 });
  assert.equal(result.costUsd, cost(10));
});

for (const area of ['contatos', 'robos']) test(`caller real preserva contexto legítimo sem jornada: ${area}`, async (t) => {
  const { result, calls } = await fixture(t, { area });
  assert.equal(result.status, 'aprovado', JSON.stringify(result.diagnostic));
  assert.equal(result.corrections, 0);
  assert.equal(result.preserved, true);
  assert.ok(result.mdx.includes(contextText));
  assert.deepEqual(result.reviewTasks, tasks(area).map(({ id }) => id));
  assert.ok(result.trace.some(({ claim }) => claim === contextText));
  assert.equal(calls.length, 5);
  assert.deepEqual(result.usage, { inputTokens: 500, outputTokens: 100 });
  assert.equal(result.costUsd, cost(5));
});

test('caller real repassa a pauta: guia omitido exige revisão, nunca corte silencioso (M7)', async (t) => {
  const page = pageFor();
  const omitted = page.sections.pop().taskId;
  const { result } = await fixture(t, { page });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.corrections, 1);
  assert.ok(result.diagnostic.includes(`tarefa ausente: ${omitted}`));
  assert.equal(result.mdx, undefined);
});

test('caller real bloqueia dado sensível mesmo com juízes favoráveis (M8)', async (t) => {
  const page = pageFor();
  page.sections[0].units[0].text = 'O cadastro usa pessoa@example.test.';
  const { result } = await fixture(t, { page });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.deepEqual(result.diagnostic, ['conteúdo sensível na página']);
  assert.equal(result.mdx, undefined);
  assert.equal(result.costUsd, cost(5));
  assert.deepEqual(result.usage, { inputTokens: 500, outputTokens: 100 });
  assert.ok(!JSON.stringify(result).includes('pessoa@example.test'));
});

test('caller real entrega imagem ao redator mas mantém aprovação pendente (M6b)', async (t) => {
  const { result, calls, screenshotId } = await fixture(t, { screenshot: true });
  assert.equal(result.status, 'aprovado');
  assert.ok(result.screenshots.length > 0);
  assert.ok(result.screenshots.every(({ approval }) => approval === 'pendente'));
  assert.equal(result.screenshots[0].screenshotId, screenshotId);
  assert.ok(calls[0].input[1].content.some(({ type }) => type === 'input_image'));
  assert.ok(!calls[0].input[1].content[0].text.includes(screenshotId));
  assert.ok(!result.mdx.includes(screenshotId));
});

test('caller real reavalia reescrita válida e aprova com corrections=1 (M4c)', async (t) => {
  const page = pageFor();
  page.sections[0].units[0].text = 'Promessa sem evidência.';
  const { result, calls } = await fixture(t, { page, rewrite: pageFor(), factual: ({ text }) =>
    text === 'Promessa sem evidência.' ? { status: 'a confirmar', reason: 'Sem prova.' } : {} });
  assert.equal(result.status, 'aprovado');
  assert.equal(result.corrections, 1);
  assert.ok(result.mdx.includes(contextText));
  assert.ok(!result.mdx.includes('Promessa sem evidência.'));
  assert.equal(calls.filter(({ text }) => text.format.name === 'faq_facts_v2').length, 2);
  assert.equal(calls.filter(({ text }) => text.format.name === 'faq_editorial_v2').length, 6);
  assert.deepEqual(result.usage, { inputTokens: 1000, outputTokens: 200 });
  assert.equal(result.costUsd, cost(10));
});

test('descrição com aspas ASCII preserva valor semântico do frontmatter', async (t) => {
  const page = pageFor();
  page.description = 'Use o botão "Salvar" para guardar o contato.';
  page.descriptionEvidenceIds = ['F1'];
  const { result } = await fixture(t, { page });
  assert.equal(result.status, 'aprovado', JSON.stringify(result.diagnostic));
  assert.equal(result.corrections, 0);
  assert.equal(result.preserved, true);
  assert.equal(parse(result.mdx.split('---')[1]).description, page.description);
});

for (const source of ['redator', 'juiz']) test(`caller real rejeita evidência inexistente do ${source} (M5a/M5b)`, async (t) => {
  const page = pageFor();
  if (source === 'redator') page.sections[0].units[0].evidenceIds = ['F1', 'X9'];
  const { result } = await fixture(t, { page,
    factual: () => source === 'juiz' ? { evidenceIds: ['F1', 'X9'] } : {} });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.corrections, 1);
  assert.equal(result.mdx, undefined);
  assert.ok(result.diagnostic.length > 0);
});

test('modelo sem preço mantém consumo conhecido e custo desconhecido', async (t) => {
  const { result } = await fixture(t, { model: 'modelo-sem-tabela' });
  assert.equal(result.status, 'aprovado');
  assert.deepEqual(result.usage, { inputTokens: 500, outputTokens: 100 });
  assert.equal(result.costUsd, null);
  assert.ok(result.costDiagnostic.includes('preço do modelo indisponível'));
});

test('usage ausente não vira zero nem custo completo; preserva consumo conhecido', async (t) => {
  const { result } = await fixture(t, { response: (_request, value, count) => ({
    status: 'completed', output_text: JSON.stringify(value), ...(count === 1 ? {} : { usage }),
  }) });
  assert.equal(result.status, 'aprovado');
  assert.equal(result.costUsd, null);
  assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null });
  assert.deepEqual(result.knownUsage, { inputTokens: 400, outputTokens: 80 });
  assert.ok(result.costDiagnostic.includes('consumo indisponível em uma ou mais chamadas'));
});

for (const failure of ['invalid-count', 'invalid-json', 'incomplete', 'transport'])
  test(`falha paga preserva consumo e estado parcial sem resposta bruta: ${failure}`, async (t) => {
    const marker = 'RAW_PRIVATE_RESPONSE_DO_NOT_RETURN';
    const { result } = await fixture(t, { response: (request, value) => {
      if (request.text.format.name !== 'faq_facts_v2') return;
      if (failure === 'transport') throw new Error(marker);
      return { usage, status: failure === 'incomplete' ? 'incomplete' : 'completed',
        output_text: failure === 'invalid-json' ? marker : JSON.stringify({ claims: [] }) };
    } });
    assert.equal(result.status, 'precisa de revisão humana');
    assert.equal(result.partial, true);
    assert.equal(result.mdx, undefined);
    assert.equal(result.module, 'robos');
    assert.deepEqual(result.reviewTasks, tasks('robos').map(({ id }) => id));
    if (failure === 'transport') {
      assert.equal(result.costUsd, null);
      assert.deepEqual(result.knownUsage, { inputTokens: 400, outputTokens: 80 });
    } else {
      assert.deepEqual(result.usage, { inputTokens: 500, outputTokens: 100 });
      assert.equal(result.costUsd, cost(5));
    }
    assert.ok(result.diagnostic.length > 0);
    assert.ok(!JSON.stringify(result).includes(marker));
  });

