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
  factual, response, screenshot = false, completed = false, model = 'gpt-6-astra', business = [] } = {}) {
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
    businessLoader: async () => business,
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

for (const stage of ['faq_page_v2', 'faq_facts_v2', 'faq_editorial_v2', 'faq_rewrite_v2'])
  for (const category of ['resposta incompleta', 'JSON inválido', 'falha de comunicação'])
    test(`diagnóstico seguro identifica categoria e etapa: ${stage}, ${category}`, async (t) => {
      const marker = 'RAW_PRIVATE_ERROR_AND_RESPONSE';
      const page = pageFor();
      if (stage === 'faq_rewrite_v2') page.sections[0].units[0].text = 'Afirmação sem prova.';
      const { result } = await fixture(t, { page,
        factual: ({ text }) => text === 'Afirmação sem prova.' ? { status: 'a confirmar' } : {},
        response: (request) => {
          if (request.text.format.name !== stage) return;
          if (category === 'falha de comunicação') throw new Error(marker);
          return { usage, status: category === 'resposta incompleta' ? 'incomplete' : 'completed',
            output_text: marker };
        },
      });
      assert.equal(result.status, 'precisa de revisão humana');
      assert.equal(result.partial, true);
      assert.equal(result.mdx, undefined);
      assert.deepEqual(result.diagnostic, [`${category}: ${stage}`]);
      assert.ok(result.knownUsage.inputTokens >= 100 || category === 'falha de comunicação');
      assert.ok(!JSON.stringify(result).includes(marker));
    });

test('diagnóstico seguro identifica validação do juiz sem devolver seu erro bruto', async (t) => {
  const { result } = await fixture(t, { response: (request) => request.text.format.name === 'faq_facts_v2'
    ? { usage, status: 'completed', output_text: JSON.stringify({ claims: [] }) } : undefined });
  assert.equal(result.partial, true);
  assert.deepEqual(result.diagnostic, ['resultado inválido: faq_facts_v2']);
  assert.equal(result.costUsd, cost(5));
});

test('diagnóstico seguro mantém falha inesperada genérica, sem detalhes internos', async (t) => {
  const { result } = await fixture(t, { response: (request) => request.text.format.name === 'faq_page_v2'
    ? { usage, status: 'completed', output_text: JSON.stringify({ ...pageFor(), sections: null }) } : undefined });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.partial, true);
  assert.equal(result.mdx, undefined);
  assert.deepEqual(result.diagnostic, ['falha na geração ou julgamento']);
  assert.deepEqual(result.knownUsage, { inputTokens: 100, outputTokens: 20 });
});

test('diagnóstico seguro identifica validação do juiz editorial', async (t) => {
  const { result } = await fixture(t, { response: (request) => request.text.format.name === 'faq_editorial_v2'
    ? { usage, status: 'completed', output_text: JSON.stringify({ ...editorial, notas: {} }) } : undefined });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.partial, true);
  assert.equal(result.mdx, undefined);
  assert.deepEqual(result.diagnostic, ['resultado inválido: faq_editorial_v2']);
  assert.deepEqual(result.knownUsage, { inputTokens: 300, outputTokens: 60 });
  assert.equal(result.costUsd, cost(3));
});


// Prova de ENCAMINHAMENTO de prompt, não de qualidade do LLM: os providers são falsos e nenhuma
// chamada real acontece. O juiz de fatos falso recusa um caso de uso procedural sem taskId para
// forçar a única reescrita; verificamos as instruções que chegam a faq_page_v2 e faq_rewrite_v2.
const procedural = 'Ao concluir o cadastro, o item novo aparece na lista.';
const businessFact = { body: 'Equipes de atendimento organizam o relacionamento com clientes.' };
const sentences = (text) => text.split(/(?<=\.)\s+/u);
const hasRule = (text, ...patterns) => sentences(text).some((sentence) =>
  patterns.every((pattern) => pattern.test(sentence)));
async function forwarded(t, area) {
  const page = pageFor(area);
  page.sections.push({ heading: 'Casos de uso', headingEvidenceIds: [], taskId: null,
    units: [{ text: procedural, kind: 'contexto', evidenceIds: ['F1'] }] });
  const { result, calls } = await fixture(t, { area, page, business: [businessFact],
    factual: (claim) => claim.taskId === null && claim.field?.includes('.units[')
      ? { status: 'a confirmar', reason: 'Procedimento sem jornada concluída.' } : undefined });
  const named = (name) => calls.filter(({ text }) => text.format.name === name);
  return { page, result, draft: named('faq_page_v2'), rewrite: named('faq_rewrite_v2'),
    facts: named('faq_facts_v2') };
}

for (const area of ['contatos', 'robos']) test(`redator e reescrita recebem as mesmas instruções, pauta e evidências; juiz de fatos intacto: ${area}`, async (t) => {
  const { page, result, draft, rewrite, facts } = await forwarded(t, area);
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.corrections, 1);
  assert.equal(result.mdx, undefined);
  assert.ok(result.diagnostic.some((item) => item.includes('Procedimento sem jornada concluída.')));
  assert.equal(draft.length, 1);
  assert.equal(rewrite.length, 1);
  assert.equal(facts.length, 2);
  const [developer, user] = draft[0].input;
  assert.equal(developer.role, 'developer');
  const writer = developer.content;
  assert.equal(rewrite[0].input[0].role, 'developer');
  assert.ok(rewrite[0].input[0].content.startsWith(`${writer}\n`), 'reescrita herda as instruções do redator');
  assert.match(rewrite[0].input[0].content.slice(writer.length), /UMA vez.*Não invente passos/su);
  // Barreiras que já existiam continuam no texto do redator.
  assert.ok(hasRule(writer, /sem jornada/u, /sem passo ou efeito/u));
  assert.ok(hasRule(writer, /não o invente/u));
  assert.ok(hasRule(writer, /somente evidenceIds existentes/u));
  // Pauta e evidências chegam ao redator e à reescrita.
  const draftInput = JSON.parse(user.content[0].text);
  const rewriteInput = JSON.parse(rewrite[0].input[1].content);
  for (const input of [draftInput, rewriteInput]) {
    assert.deepEqual(input.plan.tasks.map(({ id, status }) => [id, status]),
      tasks(area).map(({ id }) => [id, 'sem jornada']));
    assert.ok(input.evidence.some(({ type, text }) => type === 'front' && text.includes('Criar robô')));
    assert.ok(input.evidence.some(({ type, text }) => type === 'negocio' && text === businessFact.body));
  }
  assert.deepEqual(rewriteInput.page, page);
  assert.ok(rewriteInput.report.diagnostic.some((item) => item.includes('Procedimento sem jornada concluída.')));
  // O juiz de fatos continua exigindo jornada para procedimento, com ou sem taskId.
  for (const call of facts) {
    assert.match(call.input[0].content, /Renomear kind para contexto ou omitir taskId não dispensa jornada/u);
    assert.match(call.input[0].content, /sem vínculo com tarefa, deve ficar a confirmar/u);
  }
});

const writerRules = {
  'seções sem taskId não descrevem ação nem resultado de tarefa': [
    [/sem taskId/u, /O que é/u, /Para que serve/u, /Casos de uso/u, /\bnão\b/u, /ação|procediment/u, /resultado|efeito/u],
    [/caso/iu, /guia/u, /taskId/u, /necessidade|benefício/u],
    [/unidade/u, /herd/u, /taskId/u, /seção/u],
  ],
  'casos de uso distintos sem repetir o benefício de Para que serve': [
    [/Casos de uso/u, /Para que serve/u, /repet|repit/u, /benefício/u, /distint|diferent/u],
  ],
  'tarefa sem jornada traz finalidade do front e do negócio, sem listar controles': [
    [/sem jornada/u, /front/u, /negócio/u, /finalidade|por que|quando/u, /controle/u, /passo/u, /efeito/u],
  ],
  'permissão documentada é contexto, não instrução sem jornada própria': [
    [/permiss|acesso/u, /contexto/u, /conferir|habilitar|configurar/u, /jornada/u],
  ],
  'cliques e confirmações só os observados, na ordem da jornada': [
    [/ordem/u, /jornada/u, /observ/u, /clique|confirmaç/u, /etapa|passo/u, /rótulo|nome/u],
  ],
  'tarefa sem jornada: front e negócio sustentam finalidade e pré-requisito, nunca funcionamento, resultado ou orientação de execução': [
    [/sem jornada/u, /finalidade/u, /pré-requisito|requisito/u, /funcionamento/u, /mesmo que a fonte de negócio/u],
    [/sem jornada/u, /orient/u, /execut/u, /processo|planejamento/u],
  ],
  // Clareza (humanizer R3): papel da escolha observada e ação seguinte, dentro da fronteira W1.
  'escolha observada em tarefa com jornada: dizer o que ela define e a ação seguinte, sem autorizar efeito sem jornada': [
    [/escolha/u, /lista|opção/u, /jornada/u, /define|representa/u, /ação seguinte/u, /não autorizam efeito/u, /não invente|nem invente/u],
  ],
  'termo explicado na primeira ocorrência, com rótulo real; palavras usuais e benefício sustentado': [
    [/primeira vez/u, /termo/u, /rótulo/u, /expliq|explic/u],
    [/palavras usuais/u, /sujeito concreto/u, /benefício/u, /finalidade/u],
  ],
  'cada unidade acrescenta informação: sem reformular a anterior nem repetir abertura; pontes de passos repetidos preservadas': [
    [/unidade/u, /acrescenta/u, /reformul/u, /abertura/u, /pontes|para começar/u],
  ],
  // R4 real (b08): negativa inventada a partir de valor anonimizado; critério de operação em tarefa sem jornada;
  // casos que param na necessidade. Regras genéricas, sem termo de produto.
  'ausência de valor ou nome na captura não prova que nada foi escolhido; sem negar ação nem inferir valor oculto': [
    [/ausência de um valor/u, /não prova/u, /não negue/u, /valor oculto/u, /sequência observada/u, /conclusão estruturada/u],
    [/política|status/u, /sem jornada/u, /honestidade/u],
  ],
  'tarefa sem jornada: sem critérios de busca, campos ou modo de operação como finalidade': [
    [/sem jornada/u, /critérios de busca/u, /modo de operação/u, /finalidade/u, /pré-requisitos/u, /tarefas concluídas/u],
  ],
  'caso concreto liga situação, recurso escolhido e finalidade documentada, sem ação nem resultado sem jornada': [
    [/caso concreto/u, /situação distinta/u, /recurso escolhido/u, /finalidade|benefício/u, /sem ação na tela/u, /resultado/u, /evite repetir/u, /Para que serve/u],
  ],
};
for (const area of ['contatos', 'robos']) test(`regras de taskId, jornada, finalidade e ordem chegam ao redator e à reescrita: ${area}`, async (t) => {
  const { draft, rewrite } = await forwarded(t, area);
  const sent = { faq_page_v2: draft[0].input[0].content, faq_rewrite_v2: rewrite[0].input[0].content };
  for (const [rule, groups] of Object.entries(writerRules)) await t.test(rule, () => {
    for (const [stage, text] of Object.entries(sent)) for (const patterns of groups)
      assert.ok(hasRule(text, ...patterns), `${stage} sem a regra: ${rule} (${patterns.join(' ')})`);
  });
});

// Casos reais da R3 (fonte 660cc52): afirmações de contexto em tarefas sem jornada que o juiz factual reprovou.
// c23 (Contatos) descreve funcionamento documentado no negócio; c65 (Robôs) orienta a execução da tarefa.
// A prova offline verifica a fronteira de evidência nos dois prompts e o encaminhamento do diagnóstico e do escopo
// à reescrita; o comportamento do modelo só se mede em rodada real.
const realContextRejections = {
  contatos: { task: 'contatos.definir_responsavel', claim: 'c23',
    text: 'O encaminhamento direto ao responsável se aplica a novos atendimentos iniciados pelo cliente e depende de um canal conectado para receber a conversa.',
    reason: 'Afirma um efeito operacional de encaminhamento. Embora descrito em B338, falta jornada concluída de definir responsável que demonstre esse funcionamento e suas condições.' },
  robos: { task: 'robos.publicar_ativar', claim: 'c65',
    text: 'Considere essa etapa no planejamento tanto de um novo robô quanto de mudanças em um fluxo já usado pela empresa.',
    reason: 'Apesar do kind de contexto, orienta a inclusão da publicação no processo de criação ou alteração. A tarefa real de publicar/ativar está sem jornada concluída.' },
};
for (const [area, real] of Object.entries(realContextRejections)) test(`fronteira de evidência em tarefa sem jornada chega ao redator e à reescrita com o diagnóstico real (${real.claim}): ${area}`, async (t) => {
  const page = pageFor(area);
  const section = page.sections.find(({ taskId }) => taskId === real.task);
  assert.ok(section, `pauta da área inclui ${real.task}`);
  section.units.push({ text: real.text, kind: 'contexto', evidenceIds: ['F1'] });
  const { result, calls } = await fixture(t, { area, page, business: [businessFact],
    factual: (claim) => claim.text === real.text ? { status: 'a confirmar', reason: real.reason } : undefined });
  assert.equal(result.status, 'precisa de revisão humana');
  assert.equal(result.corrections, 1);
  assert.ok(result.diagnostic.some((item) => item.includes(real.reason)));
  const named = (name) => calls.filter(({ text }) => text.format.name === name);
  const writer = named('faq_page_v2')[0].input[0].content;
  const rewriteCall = named('faq_rewrite_v2')[0];
  const rewriter = rewriteCall.input[0].content;
  // W1: em tarefa sem jornada, front e negócio sustentam finalidade, público e pré-requisito; funcionamento,
  // resultado e orientação de execução exigem jornada concluída, mesmo quando o negócio descreve o comportamento.
  for (const [stage, text] of Object.entries({ faq_page_v2: writer, faq_rewrite_v2: rewriter })) {
    assert.ok(hasRule(text, /sem jornada/u, /finalidade/u, /pré-requisito|requisito/u, /funcionamento/u, /mesmo que a fonte de negócio/u),
      `${stage}: funcionamento documentado no negócio não entra em tarefa sem jornada`);
    assert.ok(hasRule(text, /sem jornada/u, /orient/u, /execut/u, /processo|planejamento/u),
      `${stage}: sem orientação de execução em tarefa sem jornada`);
  }
  // Barreiras anteriores permanecem.
  assert.ok(hasRule(writer, /sem jornada/u, /sem passo ou efeito/u));
  assert.ok(hasRule(writer, /não o invente/u));
  // R1: a reescrita remove ou reduz a afirmação a confirmar, sem preservar efeito nem orientação.
  const tail = rewriter.slice(writer.length);
  assert.match(tail, /UMA vez.*Não invente passos/su);
  assert.ok(hasRule(tail, /a confirmar/u, /remova|reduza/u, /finalidade|pré-requisito/u, /não a reformule/u),
    'reescrita sem regra de correção para item a confirmar');
  // Diagnóstico real e escopo (tarefa sem jornada) chegam à reescrita.
  const rewriteInput = JSON.parse(rewriteCall.input[1].content);
  assert.ok(rewriteInput.report.diagnostic.some((item) => item.includes(real.reason)));
  assert.ok(rewriteInput.report.facts.some((item) => item.status === 'a confirmar'));
  assert.equal(rewriteInput.plan.tasks.find(({ id }) => id === real.task).status, 'sem jornada');
  assert.ok(rewriteInput.page.sections.some(({ taskId, units }) => taskId === real.task
    && units.some(({ text }) => text === real.text)));
});
