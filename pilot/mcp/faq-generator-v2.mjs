import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import tasksCatalog from '../architecture/faq-regua/tarefas-ouro.json' with { type: 'json' };
import { getIhelpContext } from './product-context-service.mjs';
import { loadBusinessContext, judgeClaims, splitClaims } from './faq-editorial.mjs';
import { judgeEditorial, consolidateEditorialReadings, FAQ_WRITER_GLOSSARY } from './faq-editorial-judge.mjs';
import { readJourney } from './journey-service.mjs';
import { configuredJourneyIdentity } from './journey-runtime.mjs';
import { containsSensitiveData } from './sensitive-data.mjs';
import { validateFaqMdx } from './faq-mdx-safety.mjs';
import { mentionsSource } from './source-mention.mjs';

const modules = new Set(['contatos', 'robos']);
const rates = { 'gpt-6-astra': [10, 50], 'gpt-6-sol': [2, 10], 'gpt-6-luna': [0.10, 0.50] };
const object = (properties) => ({ type: 'object', additionalProperties: false,
  required: Object.keys(properties), properties });
const unitSchema = object({ text: { type: 'string' }, kind: { type: 'string', enum: ['contexto', 'passo', 'depois'] },
  evidenceIds: { type: 'array', items: { type: 'string' } } });
const pageSchema = object({ title: { type: 'string' }, titleEvidenceIds: { type: 'array', items: { type: 'string' } },
  description: { type: ['string', 'null'] }, descriptionEvidenceIds: { type: 'array', items: { type: 'string' } },
  sections: { type: 'array', items: object({
  heading: { type: 'string' }, headingEvidenceIds: { type: 'array', items: { type: 'string' } },
  taskId: { type: ['string', 'null'] }, units: { type: 'array', items: unitSchema },
}) } });
const factSchema = object({ claims: { type: 'array', items: object({ id: { type: 'string' },
  status: { type: 'string', enum: ['sustentada', 'a confirmar', 'contradiz a fonte'] },
  reason: { type: 'string' }, sourceMention: { type: 'boolean' },
  evidenceIds: { type: 'array', items: { type: 'string' } },
}) } });
const usageOf = (response) => ({ inputTokens: response?.usage?.input_tokens ?? 0,
  outputTokens: response?.usage?.output_tokens ?? 0 });
const sumUsage = (a, b) => ({ inputTokens: a.inputTokens + (b.inputTokens ?? 0),
  outputTokens: a.outputTokens + (b.outputTokens ?? 0) });

export function planFaqPage(module, tasks, journeys) {
  if (!modules.has(module)) throw new Error('módulo inválido');
  const byTask = new Map(journeys.map((journey) => [journey.task, journey]));
  const planned = tasks.map((task) => {
    const journey = byTask.get(task.id);
    const completed = journey?.status === 'concluída' && journey?.verification?.confirmed === true
      && (!journey.accountProof || journey.identityVerified === true);
    return { id: task.id, title: task.tarefa, start: task.pontoDePartida,
      status: completed ? 'concluída' : 'sem jornada', journeyEvidenceIds: completed ? [`J:${task.id}`] : [] };
  });
  return { module, overview: ['O que é', 'Para que serve', 'Casos de uso'], tasks: planned,
    reviewTasks: planned.filter((task) => task.status === 'sem jornada').map((task) => task.id) };
}

const proseOf = (unit) => unit.kind === 'passo'
  ? unit.text.replace(/^\s*\d+[.)]\s+/u, '') : unit.text;
const unitsOf = (page) => page.sections.flatMap((section) => section.units.map((unit) =>
  ({ ...unit, text: proseOf(unit), taskId: section.taskId })));
const referenceIds = (units) => [...new Set(units.flatMap((unit) => unit.evidenceIds ?? []))];
const markdownLabels = /(!?)\[([^\]\n]+)\]\([^\s)]+\)/gu;
function publishedFields(page) {
  const fields = page.sections.flatMap((section, sectionIndex) => section.units.map((unit, unitIndex) => ({
    text: proseOf(unit), kind: unit.kind, taskId: section.taskId, evidenceIds: unit.evidenceIds,
    field: `sections[${sectionIndex}].units[${unitIndex}]`,
  })));
  const metadata = [
    { text: page.title, evidenceIds: page.titleEvidenceIds ?? referenceIds(unitsOf(page)), field: 'title' },
    ...(page.description ? [{ text: page.description,
      evidenceIds: page.descriptionEvidenceIds ?? referenceIds(unitsOf(page)), field: 'description' }] : []),
    ...page.sections.map((section, index) => ({ text: section.heading,
      evidenceIds: section.headingEvidenceIds ?? referenceIds(section.units),
      taskId: section.taskId, field: `sections[${index}].heading` })),
  ];
  return [...fields, ...metadata].flatMap((field) => [field, ...[...String(field.text ?? '').matchAll(markdownLabels)]
    .map((match) => ({ ...field, text: match[2], field: `${field.field}.${match[1] ? 'imageAlt' : 'linkText'}` }))]);
}
const faqFrontmatter = (page) => `---\ntitle: ${JSON.stringify(page.title)}\n${page.description
  ? `description: ${JSON.stringify(page.description)}\n` : ''}---\n\n`;
function renderPage(page) {
  return [`# ${page.title}`, ...page.sections.map((section) => {
    let number = 0;
    return `## ${section.heading}\n\n${section.units.map((unit) => unit.kind === 'passo'
      ? `${++number}. ${proseOf(unit)}` : unit.kind === 'depois'
        ? `**O que acontece depois:** ${unit.text}` : unit.text).join('\n\n')}`;
  })].join('\n\n');
}
export function assembleFaqPage(page, { render = renderPage } = {}) {
  const mdx = render(page);
  const losses = unitsOf(page).filter(({ text }) => !mdx.includes(text)).map(({ text }) => text);
  return render === renderPage ? mdx : { mdx, losses };
}

function preflight(page, evidence, plan) {
  const problems = [];
  const known = new Map(evidence.map((item) => [item.id, item]));
  if (!page?.sections?.length) problems.push('página vazia');
  if (plan) for (const task of plan.tasks) if (!page?.sections?.some((section) => section.taskId === task.id))
    problems.push(`tarefa ausente: ${task.id}`);
  for (const field of publishedFields(page)) {
    if (!field.text?.trim()) problems.push(`texto vazio: ${field.field}`);
    if (!field.evidenceIds?.length) problems.push(`afirmação sem evidência: ${field.field}`);
    for (const id of field.evidenceIds ?? []) if (!known.has(id)) problems.push(`evidência ausente: ${id}`);
    if (field.evidenceIds?.length && field.evidenceIds.every((id) =>
      known.get(id)?.type === 'verificacao')) problems.push(`afirmação apoiada só na verificação: ${field.field}`);
  }
  for (const section of page?.sections ?? []) {
    const task = plan?.tasks.find((item) => item.id === section.taskId);
    if (section.taskId && plan && !task) problems.push(`tarefa fora da pauta: ${section.taskId}`);
    for (const unit of section.units ?? []) {
      if (['passo', 'depois'].includes(unit.kind) && (!section.taskId || (plan && task?.status !== 'concluída')
        || !evidence.some((item) => item.type === 'jornada' && item.task === section.taskId
          && item.status === 'concluída')))
        problems.push(`passo ou efeito sem tarefa com jornada concluída: ${section.taskId ?? 'sem vínculo'}`);
      if (unit.kind === 'depois' && !unit.evidenceIds?.some((id) =>
        known.get(id)?.type === 'jornada' && known.get(id)?.task === section.taskId
          && known.get(id)?.status === 'concluída')) problems.push(`efeito sem jornada: ${section.taskId}`);
    }
  }
  return problems;
}

export async function runFaqJudgment(page, evidence, providers, { plan } = {}) {
  let current = page, corrections = 0, usage = { inputTokens: 0, outputTokens: 0 };
  for (;;) {
    const claims = publishedFields(current).flatMap((field) => splitClaims(field.text).filter((text) =>
      field.field.includes('.units[') ? !text.endsWith('?') : true).map((text) =>
      ({ text, evidenceIds: field.evidenceIds, kind: field.kind, taskId: field.taskId,
        field: field.field })))
      .map((unit, index) => ({ ...unit, id: `c${index + 1}` }));
    const [facts, editorial] = await Promise.all([
      providers.judgeFacts(claims, current, evidence), providers.judgeEditorial(current, evidence),
    ]);
    usage = sumUsage(sumUsage(usage, facts.usage ?? {}), editorial.usage ?? {});
    const verdicts = Array.isArray(facts) ? facts : facts.claims;
    const diagnostic = preflight(current, evidence, plan);
    const trace = claims.map((claim) => {
      const verdict = verdicts?.find((item) => item.id === claim.id);
      const linked = verdict?.evidenceIds?.length && verdict.evidenceIds.every((id) =>
        evidence.some((item) => item.id === id)) && verdict.evidenceIds.some((id) =>
        evidence.some((item) => item.id === id && item.type !== 'verificacao'));
      if (!verdict || verdict.status !== 'sustentada' || !linked || mentionsSource(claim.text))
        diagnostic.push(`${claim.id}: ${verdict?.status ?? 'sem julgamento'}: ${verdict?.reason ?? 'sem evidência válida'}`);
      const afterAnchor = claim.kind === 'depois' ? claim.evidenceIds?.find((id) => evidence.some((item) =>
        item.id === id && item.type === 'jornada' && item.task === claim.taskId && item.status === 'concluída')) : null;
      const afterProof = claim.kind === 'depois' && verdict?.evidenceIds?.some((id) => evidence.some((item) =>
        item.id === id && item.type === 'jornada' && item.status === 'concluída'));
      if (claim.kind === 'depois' && (!afterAnchor || !afterProof))
        diagnostic.push(`${claim.id}: efeito sem evidência da jornada concluída`);
      return { claim: claim.text, field: claim.field, taskId: claim.taskId ?? null,
        status: verdict?.status ?? 'sem julgamento',
        evidence: [...new Set([...(verdict?.evidenceIds ?? []), ...(afterAnchor ? [afterAnchor] : [])])].map((id) => ({ id,
          type: evidence.find((item) => item.id === id)?.type ?? 'desconhecida' })),
        reason: verdict?.reason ?? '' };
    });
    if (!editorial?.aceite) {
      for (const [criterion, score] of Object.entries(editorial?.notas ?? {}))
        if (score !== null && score < 3) diagnostic.push(`critério ${criterion}: ${score}`);
      for (const grave of editorial?.defeitosGraves ?? []) diagnostic.push(`grave: ${grave}`);
      if (!Object.values(editorial?.notas ?? {}).some((score) => score !== null && score < 3)
        && !(editorial?.defeitosGraves ?? []).length) diagnostic.push('juiz editorial reprovou');
    }
    for (const item of editorial?.naoVerificaveis ?? []) if (!trace.some((row) => row.claim.includes(item)
      && row.status === 'sustentada')) diagnostic.push(`não verificável: ${item}`);
    const body = assembleFaqPage(current);
    const mdx = `${faqFrontmatter(current)}${body}\n`;
    const losses = publishedFields(current).filter(({ text }) => !mdx.includes(text)).map(({ text }) => text);
    diagnostic.push(...losses.map((text) => `perda na montagem: ${text}`));
    try { validateFaqMdx(body); } catch (error) { diagnostic.push(`MDX: ${error.message}`); }
    if (!diagnostic.length) return { approved: true, status: 'aprovado', mdx, page: current, trace,
      editorial, corrections, preserved: true, usage };
    if (corrections || !providers.rewrite) return { approved: false, status: 'precisa de revisão humana',
      trace, editorial, corrections, diagnostic, preserved: losses.length === 0, usage };
    current = await providers.rewrite(current, { diagnostic, facts: verdicts, editorial }, evidence);
    corrections++;
  }
}

const visible = (value) => typeof value === 'string' && value.trim() && value !== '[conteúdo oculto]'
  ? value.trim() : null;
const uniqueVisible = (values) => [...new Set(values.map(visible).filter(Boolean))];

export function projectFaqEvidence(plan, journeys, context, business) {
  const evidence = [];
  for (const item of context.screenFacts ?? []) if (item?.text) evidence.push({ id: `F${evidence.length + 1}`,
    type: 'front', text: item.text, kind: item.kind, source: item.source });
  for (const item of business) evidence.push({ id: `B${evidence.length + 1}`, type: 'negocio', text: item.body });
  for (const item of plan.tasks) {
    const journey = journeys.find((row) => row.task === item.id);
    if (!journey) continue;
    if (item.status !== 'concluída') continue;
    const screens = journey.screens ?? [];
    const product = {
      acoes: uniqueVisible((journey.actions ?? []).map(({ name }) => name)),
      campos: uniqueVisible(screens.flatMap(({ fields }) => (fields ?? []).map(({ name }) => name))),
      telas: uniqueVisible(screens.map(({ title }) => title)),
      mensagens: uniqueVisible(screens.flatMap(({ messages }) => messages ?? [])),
      estadoVisivelDepois: {
        titulos: uniqueVisible([journey.after?.headings, screens.at(-1)?.state?.headings]),
        controles: uniqueVisible((screens.at(-1)?.controlsOffered ?? []).map(({ name }) =>
          typeof name === 'string' ? name : null)),
        mensagens: uniqueVisible(screens.at(-1)?.messages ?? []),
      },
    };
    evidence.push({ id: `J:${item.id}`, type: 'jornada', task: item.id,
      status: 'concluída', concluida: true, text: JSON.stringify(product) });
  }
  return evidence;
}

async function modelResponse(client, model, name, schema, input) {
  const result = await client.responses.create({ model, store: false, reasoning: { effort: 'medium' },
    max_output_tokens: 16000, text: { format: { type: 'json_schema', name, strict: true, schema } }, input });
  if (result.status !== 'completed') throw new Error(`resposta incompleta: ${name}`);
  return { value: JSON.parse(result.output_text), usage: usageOf(result) };
}
const publicEvidence = (evidence) => evidence.map(({ id, type, task, status, text }) =>
  ({ id, type, task, status, text, ...(type === 'jornada' ? { concluida: status === 'concluída' } : {}) }));

export function faqWriterInput(plan, tasks, evidence, screenshots) {
  return JSON.stringify({ plan: { ...plan, tasks: plan.tasks.map(({ id, title, status, journeyEvidenceIds }) =>
    ({ id, title, status, journeyEvidenceIds })) },
  tasks: tasks.map(({ id, tarefa }) => ({ id, tarefa })), evidence: publicEvidence(evidence),
  screenshots: screenshots.map(({ task }) => ({ task })) });
}

export function faqWriterInstructions(rules) {
  return `Escreva a página INTEIRA em português para clientes iniciantes. Regras: ${rules.join('\n')}
  Glossário versionado do redator: ${JSON.stringify(FAQ_WRITER_GLOSSARY)}. Use os termos preferidos na prosa, preservando rótulos literais de controles do produto. Nunca transforme a mecânica da verificação em instrução ao cliente. A conclusão da tarefa é apenas um fato estruturado; detalhes de como a equipe a confirmou não são evidência de texto para a página.
  Use somente evidenceIds existentes. Dê evidência também para title, description (ou null) e cada heading; textos de links e legendas também serão julgados. Para cada tarefa concluída, escreva o resultado do produto que a conclusão estruturada confirma em uma unidade kind depois com o ID da jornada; explique o efeito da ação para a pessoa, sem descrever como a equipe verificou. Apoie detalhes no estado visível, nas mensagens e nos controles oferecidos. Se esse estado não mostrar um detalhe, não o invente. O que acontece depois deve agregar ao leitor. Não numere o texto de unidades kind passo: a montagem numera os passos. Imagens mascaradas são referência visual; não publique sem aprovação. Se tarefa estiver sem jornada, escreva somente contexto sustentado pelos fatos do front, sem passo ou efeito. Inclua O que é, Para que serve, casos concretos sustentados por evidência e um guia por tarefa; não suponha uso de WhatsApp ou CRM sem evidência. Ordene as tarefas pela pauta. Em cada guia, dê contexto, passos e efeito no mesmo fluxo; não substitua uma ação por referência a outro guia. Evite repetir a mesma orientação em guias diferentes. Faça a página seguir uma sequência lógica do uso inicial ao resultado. Cada frase deve ser uma unidade com evidência. Não mencione fonte, ensaio, staging nem pendência interna na página.`;
}

export async function generateFaqV2(root, module, { client = new OpenAI(),
  model = process.env.FAQ_GENERATOR_MODEL ?? 'gpt-6-astra', journeyReader,
  contextLoader = getIhelpContext, businessLoader = loadBusinessContext, probeAccount } = {}) {
  if (!modules.has(module)) throw new Error('módulo inválido');
  const tasks = tasksCatalog.tarefas.filter((item) => item.modulo === module);
  const journeyRoot = resolve(process.env.MCP_STATE_DIR ?? '/data', 'journeys');
  const identity = configuredJourneyIdentity(process.env).credentialHash;
  const journeys = [];
  for (const task of tasks) {
    try { journeys.push(await (journeyReader ?? readJourney)({ root: journeyRoot, module, task: task.id,
      accountHash: identity, probeAccount })); } catch { journeys.push({ task: task.id, status: 'inconclusiva' }); }
  }
  const plan = planFaqPage(module, tasks, journeys);
  const context = await contextLoader(root, `FAQ ${module}`, module, { requireLocal: true });
  const business = await businessLoader(root, module);
  const evidence = projectFaqEvidence(plan, journeys, context, business);
  if (!evidence.length) return { status: 'precisa de revisão humana', diagnostic: ['evidência indisponível'], module };
  const imageItems = [], screenshots = [];
  for (const journey of journeys.filter((item) => plan.tasks.some((task) =>
    task.id === item.task && task.status === 'concluída'))) {
    const screen = journey.screens?.at(-1);
    if (!screen?.screenshotId || !/^[a-f0-9]{64}$/u.test(screen.screenshotId)) continue;
    const image = await readFile(join(journeyRoot, module, `${screen.screenshotId}.png`)).catch(() => null);
    if (!image) continue;
    imageItems.push({ type: 'input_image', image_url: `data:image/png;base64,${image.toString('base64')}` });
    screenshots.push({ task: journey.task, screenshotId: screen.screenshotId, approval: 'pendente' });
  }
  const rules = await Promise.all(['contrato-secoes.md', 'rubrica.md'].map((name) =>
    readFile(join(root, 'architecture/faq-regua', name), 'utf8')));
  const prompt = faqWriterInput(plan, tasks, evidence, screenshots);
  const instructions = faqWriterInstructions(rules);
  const draft = await modelResponse(client, model, 'faq_page_v2', pageSchema, [
    { role: 'developer', content: instructions },
    { role: 'user', content: [{ type: 'input_text', text: prompt }, ...imageItems] },
  ]);
  let costUsage = draft.usage;
  const providers = {
    judgeFacts: async (claims, _page, facts) => {
      const section = { oQueE: [], paraQueServe: [], casosDeUso: [],
        passos: [], duvidas: [], erros: claims.map((item) => ({ text: item.text })) };
      const judged = await judgeClaims(section, { request: { module }, business }, async (items) => {
        const result = await modelResponse(client, model, 'faq_facts_v2', factSchema, [
          { role: 'developer', content: 'Julgue cada afirmação do produto usando somente evidências. Responda cada id uma vez, em ordem. Para sustentada, informe os IDs exatos que a sustentam. Jornada bloqueada não prova funcionamento. O campo estruturado concluida não sustenta frases sobre o modo de verificação, como reabrir, comparar, identificar ou confirmar persistência; é necessária observação visível do produto. Caso a frase cite fontes internas, sourceMention=true. Não reescreva.' },
          { role: 'user', content: JSON.stringify({ claims: items, evidence: publicEvidence(facts) }) },
        ]);
        costUsage = sumUsage(costUsage, result.usage);
        return result.value;
      });
      return judged.verdicts.map((item) => ({ id: item.id, status: item.status,
        evidenceIds: item.evidenceIds ?? [], reason: item.reason, sourceMention: item.sourceMention }));
    },
    judgeEditorial: async (page, facts) => {
      const readings = [];
      for (let i = 0; i < 3; i++) readings.push(await judgeEditorial({ pagina: renderPage(page), modulo: module,
        tipo: 'pagina', evidencias: { front: facts.filter((item) => item.type === 'front'),
          negocio: facts.filter((item) => item.type === 'negocio'),
          jornadas: facts.filter((item) => item.type === 'jornada') } },
      async ({ instructions: judgePrompt, input, schema }) => {
        const result = await modelResponse(client, model, 'faq_editorial_v2', schema, [
          { role: 'developer', content: judgePrompt }, { role: 'user', content: input },
        ]);
        costUsage = sumUsage(costUsage, result.usage);
        return { output_text: JSON.stringify(result.value), usage: { input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens } };
      }));
      return { ...consolidateEditorialReadings(readings),
        comments: readings.map((reading) => reading.comentario) };
    },
    rewrite: async (page, report) => {
      const result = await modelResponse(client, model, 'faq_rewrite_v2', pageSchema, [
        { role: 'developer', content: `${instructions}\nReescreva a página inteira UMA vez. Preserve fatos sustentados e corrija apenas o diagnóstico. Não invente passos.` },
        { role: 'user', content: JSON.stringify({ page, report, plan, evidence: publicEvidence(evidence) }) },
      ]);
      costUsage = sumUsage(costUsage, result.usage);
      return result.value;
    },
  };
  const result = await runFaqJudgment(draft.value, evidence, providers, { plan });
  const [inputRate, outputRate] = rates[model] ?? [0, 0];
  const costUsd = Number(((costUsage.inputTokens * inputRate + costUsage.outputTokens * outputRate) / 1e6).toFixed(6));
  const mdx = result.mdx;
  if (mdx && containsSensitiveData(mdx, { detectOpaque: true })) return { status: 'precisa de revisão humana',
    diagnostic: ['conteúdo sensível na página'], model, costUsd, corrections: result.corrections };
  return { status: result.status, module, ...(mdx ? { mdx } : {}), screenshots,
    trace: result.trace, editorial: result.editorial, diagnostic: result.diagnostic ?? [],
    reviewTasks: plan.reviewTasks, corrections: result.corrections, preserved: result.preserved,
    model, costUsd, usage: costUsage };
}
