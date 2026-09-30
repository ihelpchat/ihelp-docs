import { readFile, readdir, lstat, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { redactSensitiveData, containsSensitiveData, sensitiveKinds } from './sensitive-data.mjs';
import { valueFor } from './api-synthetic-example.mjs';
import { FAQ_NEUTRAL_WORDS, FAQ_NEUTRAL_VERBS } from './faq-neutral-words.mjs';
import { faqStem } from './faq-portuguese-stem.mjs';
import coverageMatrix from '../architecture/coverage-matrix.json' with { type: 'json' };
import { plainMarkdownText } from './faq-mdx-safety.mjs';
import { mentionsSource } from './source-mention.mjs';

export const FAQ_SECTIONS = {
  resposta: 'Resposta direta', paraQueServe: 'Para que serve', quandoUsar: 'Quando usar',
  passos: 'Passo a passo', exemplo: 'Exemplo', duvidas: 'Dúvidas comuns',
  erros: 'Erros comuns e o que fazer', suporte: 'Quando falar com o suporte',
};
const CORE = new Set(['resposta', 'passos']);
const BUSINESS_PATH = /^business-context\/[a-z0-9][a-z0-9-]*\.md$/u;
const normalized = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const literal = (quote, source) => normalized(quote).length >= 12
  && normalized(source).toLocaleLowerCase('pt-BR').includes(normalized(quote).toLocaleLowerCase('pt-BR'));
const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR');
const words = (value) => fold(value).match(/[a-z]+|\d+/gu) ?? [];
// Derivação restrita aos verbos neutros; substantivos genéricos não afirmam capacidades.
const derivedStems = new Map(FAQ_NEUTRAL_VERBS.flatMap((verb) => {
  const root = fold(verb).slice(0, -2);
  const nouns = [verb.endsWith('ar') ? `${root}acao` : `${root}imento`];
  if (verb === 'escolher') nouns.push('escolha');
  if (verb === 'editar') nouns.push('edicao');
  return nouns.map((noun) => [noun, faqStem(verb)]);
}));
const lexicalStem = (word) => derivedStems.get(singular(word)) ?? faqStem(word);
const hasLabel = (text, label) => {
  const inText = words(text), fromLabel = words(label);
  return fromLabel.length > 0 && inText.some((word, index) => word === fromLabel[0]
    && fromLabel.every((part, offset) => inText[index + offset] === part));
};
const singular = (word) => word.endsWith('oes') || word.endsWith('aes') ? `${word.slice(0, -3)}ao`
  : word.endsWith('ais') ? `${word.slice(0, -3)}al`
    : word.endsWith('eis') ? `${word.slice(0, -3)}el`
      : word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word;
const verbForms = (verb) => {
  const base = fold(verb), stem = base.slice(0, -2);
  const endings = base.endsWith('ar')
    ? ['o', 'a', 'am', 'amos', 'ei', 'ou', 'ava', 'avam', 'ando', 'ado', 'e', 'em', 'asse', 'assem', 'aria', 'ariam']
    : ['o', 'e', 'em', 'emos', 'i', 'eu', 'ia', 'iam', 'endo', 'ido', 'a', 'am', 'esse', 'essem', 'eria', 'eriam'];
  return [base, ...endings.map((ending) => stem + ending)];
};
// A mesma normalização identifica ações na frase e nos fatos citados.
const FAQ_NAVIGATION_VERBS = [
  'abrir', 'clicar', 'tocar', 'selecionar', 'escolher', 'digitar', 'preencher',
  'conferir', 'ver', 'voltar', 'localizar', 'acompanhar', 'aguardar',
];
const FAQ_DESTRUCTIVE_VERBS = [
  'apagar', 'excluir', 'remover', 'deletar', 'limpar', 'desativar',
  'desconectar', 'cancelar', 'bloquear', 'resetar', 'zerar', 'destruir',
];
const FAQ_ACTION_VERBS = [...new Set([
  ...FAQ_NAVIGATION_VERBS,
  ...FAQ_DESTRUCTIVE_VERBS,
  'criar', 'adicionar', 'salvar', 'enviar', 'ativar', 'editar', 'importar',
  'exportar', 'publicar', 'agendar', 'configurar', 'cadastrar', 'vincular',
  'transferir', 'finalizar',
])];
const FAQ_VERB_FORMS = new Map(FAQ_ACTION_VERBS.map((verb) => [verb, new Set([
  // Primeira pessoa em -o coincide com substantivos de interface (cadastro, bloqueio).
  ...verbForms(verb).filter((form) => form !== `${fold(verb).slice(0, -2)}o`), ...({
    apagar: ['apague', 'apaguem'], bloquear: ['bloqueie', 'bloqueiem'],
    clicar: ['clique', 'cliquem'], excluir: ['exclua', 'excluam', 'exclui'],
    remover: ['remova', 'removam'], deletar: ['delete', 'deletem'],
    limpar: ['limpe', 'limpem'], desativar: ['desative', 'desativem'],
    desconectar: ['desconecte', 'desconectem'], cancelar: ['cancele', 'cancelem'],
    resetar: ['resete', 'resetem'], zerar: ['zere', 'zerem'],
    destruir: ['destrua', 'destruam'],
    publicar: ['publique', 'publiquem'], localizar: ['localize', 'localizem'],
    ver: ['veja', 'vejam', 'vejo', 've', 'veem'],
  }[verb] ?? []),
])]));
const actionVerbs = (text) => [...new Set(words(text).flatMap((word) =>
  [...FAQ_VERB_FORMS].filter(([, forms]) => forms.has(word)).map(([verb]) => verb)))];
const FAQ_PROCEDURAL_IMPERATIVE = /(?:^|[.!?;,]\s*|\be\s+)(?:abra|clique|toque|preencha|digite|escolha|selecione|confira|apague|exclua|destrua|remova|delete|limpe|desative|desconecte|cancele|bloqueie|resete|zere|crie|adicione|salve|envie|ative|edite|importe|exporte|publique|agende|configure|cadastre|vincule|transfira|finalize)\b/iu;
const neutral = new Set([...FAQ_NEUTRAL_WORDS, ...FAQ_NEUTRAL_VERBS.flatMap(verbForms),
  ...derivedStems.keys(),
  'quero', 'quer', 'querem', 'queria', 'queriam', 'quis', 'quiser', 'quisesse',
  'vejo', 've', 'veem', 'vi', 'viu', 'visto', 'vendo', 'vir',
  'ofereco', 'ofereca', 'oferecam', 'escolho', 'escolha', 'escolham',
  'preencha', 'preencham', 'confira', 'confiram', 'clique', 'cliquem',
  'toque', 'toquem', 'use', 'uses', 'abra', 'abram', 'abre', 'abrem', 'abriu', 'abrindo',
].map((word) => singular(fold(word))));
const contentWords = (value, request = {}) => {
  const theme = new Set(words(`${request.topic ?? ''} ${request.description ?? ''}`).map(faqStem));
  return words(value).filter((word) => word.length > 2
    && !neutral.has(singular(word)) && !theme.has(faqStem(word)));
};
const promiseRoot = /^(?:aument|reduz|garant|dobr|economiz|bloque|melhor)[a-z]*$|^(?:sempre|nunca)$/u;
const promiseStem = (word) => word.match(/^(?:aument|reduz|garant|dobr|economiz|bloque|melhor)/u)?.[0] ?? word;
const numbers = (value) => String(value ?? '').match(/(?:R\$|US\$|€|\$)?\s*\d+(?:[.,]\d+)*(?:\s*%|\s*(?:dias?|horas?|minutos?|meses?|anos?))?/giu) ?? [];
const properNames = (value) => [...String(value ?? '').matchAll(/\p{L}+/gu)]
  .filter((match) => (/\p{Ll}\p{Lu}/u.test(match[0]) || (match.index !== 0 && /^\p{Lu}/u.test(match[0])))
    && !neutral.has(singular(fold(match[0]))))
  .map((match) => fold(match[0]));

const syntheticEvidence = ['nome', 'email', 'telefone', 'id', 'numero', 'data', 'searchData']
  .map((name) => valueFor({ name })).join(' ');

// Ponto único para um verificador semântico futuro; hoje a decisão é extrativa.
function supportedClaim(text, sources, { example = false, request = {}, lexical = true } = {}) {
  const evidenceSources = [...sources, request.details ?? '', ...(example ? [syntheticEvidence] : [])];
  const evidence = evidenceSources.join(' ');
  const theme = new Set(words(`${request.topic ?? ''} ${request.description ?? ''}`).map(faqStem));
  const cited = new Set(words(evidence).map(lexicalStem));
  const uncovered = lexical ? [...new Set(contentWords(text, request).filter((word) => !cited.has(lexicalStem(word))))] : [];
  // Números, nomes e promessas obedecem à mesma cobertura total, inclusive nas seções centrais.
  if (numbers(text).some((number) => !evidenceSources
    .some((source) => fold(source).includes(fold(number).trim())))) {
    for (const number of numbers(text)) if (!uncovered.includes(fold(number).trim())) uncovered.push(fold(number).trim());
  }
  if (properNames(text).some((name) => !fold(evidence).includes(name) && !theme.has(faqStem(name)))) {
    for (const name of properNames(text)) if (!fold(evidence).includes(name) && !theme.has(faqStem(name)) && !uncovered.includes(name)) uncovered.push(name);
  }
  const citedPromises = new Set(words(evidence).filter((word) => promiseRoot.test(word)).map(promiseStem));
  for (const word of words(text).filter((item) => promiseRoot.test(item)))
    if (!citedPromises.has(promiseStem(word)) && !uncovered.includes(word)) uncovered.push(word);
  return uncovered;
}

const citeOf = ({ repository, path, lineStart, lineEnd, sha }) =>
  ({ repository, path, lineStart, lineEnd, sha });

// Keep task extraction consistent for the plan, the direct answer and both completeness gates.
const requestedFaqTaskText = (request = {}) => fold([
  request.topic, request.description, request.details,
].filter(Boolean).join(' '));
const requestedFaqOperationalText = (request = {}) => fold([
  request.topic,
  String(request.description ?? '').replace(/^\s*criar\s+(?:a\s+)?(?:página|faq|guia|documentação)\b/iu, ''),
  request.details,
].filter(Boolean).join(' '));

export function faqModuleName(request = {}, screenFacts = []) {
  const route = screenFacts.find((fact) => fact.kind === 'route' && fact.route)?.route ?? request.productRoute;
  const menuFact = screenFacts.find((fact) => fact.kind === 'route' && fact.route === route
    && /(?:components\/ui\/components\/NavBar\/index\.tsx|store\/slices\/tab\/tab\.slice\.ts):\d+$/u.test(fact.source ?? ''));
  return menuFact?.text ?? coverageMatrix.find((item) => item.productRoutes.includes(route))?.module
    ?? coverageMatrix.find((item) => fold(item.module) === fold(request.module))?.module
    ?? null;
}

export function replaceModuleTerminology(text, menuModule) {
  // A troca gramatical exige reescrita; preserve o texto do modelo para revisão.
  void menuModule;
  return String(text);
}

// The direct answer is assembled from requested tasks backed by screen facts.
export function deterministicFaqAnswer(request = {}, screenFacts = []) {
  const screenFact = screenFacts.find((fact) => fact.kind === 'route' && fact.text)
    ?? screenFacts.find((fact) => fact.text && hasLabel(fact.text, request.topic));
  const screen = screenFact?.kind === 'route' ? screenFact.text : screenFact ? request.topic : null;
  const asked = requestedFaqTaskText(request);
  const verbs = [
    [/\bbusc/u, /\bbusc/u, 'buscar'],
    [/\bcadastr/u, /\b(?:cadastr|cri|adicion)/u, 'cadastrar'],
    [/\b(?:cri|adicion)/u, /\b(?:cri|adicion)/u, /\brob[oô]|bot\b/iu.test(request.topic ?? '') ? 'criar' : 'cadastrar'],
    [/\bedit/u, /\bedit/u, 'editar'],
    [/\b(?:responsav|propriet|atribui|carteiriz|vincul)/u, /\b(?:responsav|propriet|departamento|usuario)/u, 'escolher o responsável'],
    [/\bimport/u, /\bimport/u, 'importar uma lista'],
    [/\bexport/u, /\bexport/u, 'exportar uma lista'],
    [/\bagend/u, /\bagend/u, 'agendar'],
    [/\b(?:montar|configur)/u, /\b(?:fluxo|bloco|opcoes)/u, 'montar o fluxo'],
    [/\b(?:ativar|publicar)/u, /\bpublicar\b/u, 'publicar'],
  ];
  const supported = verbs.flatMap(([requestPattern, factPattern, verb]) => {
    if (!requestPattern.test(asked)) return [];
    const fact = screenFacts.find((item) => item.text && factPattern.test(fold(item.text))
      && item.repository && item.path && item.sha);
    return fact ? [{ verb, citation: citeOf(fact) }] : [];
  });
  if (!screen || !supported.length) return null;
  const actions = [...new Set(supported.map((item) => item.verb))];
  const list = actions.length === 1 ? actions[0] : `${actions.slice(0, -1).join(', ')} e ${actions.at(-1)}`;
  const citations = [screenFact?.repository && screenFact.path && screenFact.sha ? citeOf(screenFact) : null,
    ...supported.map((item) => item.citation)].filter(Boolean);
  const menuModule = faqModuleName(request, screenFacts);
  return { text: `${menuModule ? 'No módulo' : 'Na tela'} **${menuModule ?? screen}**, você pode ${list}.`,
    citations: [...new Map(citations.map((cite) => [JSON.stringify(cite), cite])).values()] };
}

export function faqSubtitle(sections, request = {}, screenFacts = [], description = '') {
  const candidate = String(description ?? '').trim();
  const first = splitClaims(sections.oQueE?.[0]?.text ?? '')[0] ?? '';
  if (candidate.length >= 40 && candidate.length <= 200 && candidate === plainMarkdownText(candidate)
    && !/[<>*_[\]`#]/u.test(candidate) && !/^(?:[-+*]\s|\d+\.\s|>)/u.test(candidate)
    && !mentionsSource(candidate) && fold(candidate) !== fold(plainMarkdownText(first))) return candidate;
  const direct = deterministicFaqAnswer(request, screenFacts)?.text;
  const actions = direct?.match(/você pode (.+)\.$/u)?.[1];
  const menuModule = faqModuleName(request, screenFacts) ?? request.topic;
  const object = fold(menuModule) === 'robos' ? 'robôs de atendimento' : menuModule.toLocaleLowerCase('pt-BR');
  const fallback = actions ? `Como ${actions} ${object} no iHelp.` : `Como usar ${object} no iHelp.`;
  return fallback.length >= 40 ? fallback : `${fallback.slice(0, -1)}: veja as tarefas e os passos.`;
}

export const hasFaqTaskFacts = (screenFacts) => Array.isArray(screenFacts) && screenFacts.some((fact) =>
  ['action', 'field', 'upload', 'validation', 'destination'].includes(fact.kind) && fact.text);

// A requested task is covered only by a validated step citing one of its screen facts.
const FAQ_TASKS = [
  ['buscar', /\bbusc/u, /\bbusc|\bfiltro|limpar filtros/u],
  ['cadastrar', /\bcadastr/u, /\bcadastr|\badicionar contato/u],
  ['criar', /\bcri(?:ar|e|ando)\b/u, /\bcriar novo|\bdigite o titulo/u],
  ['editar', /\bedit/u, /\bedit/u],
  ['carteirizar', /\bcarteiriz|\bvincul|\bresponsav/u, /\bproprietario|\bdepartamento|\busuario/u],
  ['agendar', /\bagend/u, /\bagend/u],
  ['importar', /\bimport/u, /\bimport|\.csv|\.xlsx|\.xls/u],
  ['exportar', /\bexport/u, /\bexport/u],
  ['montar fluxo', /\bmontar.{0,20}\bfluxo/u, /\bfluxo|\bbloco|\bopcoes/u],
  ['ativar', /\bativ/u, /\bpublicar|\bativ/u],
];

export function faqTasksWithoutFacts(request = {}, screenFacts = []) {
  const asked = requestedFaqOperationalText(request);
  return FAQ_TASKS.flatMap(([task, requested, visible]) => requested.test(asked)
    && !screenFacts.some((fact) => fact.text && visible.test(fold(`${fact.text} ${fact.subject ?? ''}`))
      && ['action', 'field', 'upload', 'destination', 'text'].includes(fact.kind))
    ? [task[0].toLocaleUpperCase('pt-BR') + task.slice(1)] : []);
}

export function missingFaqTaskSteps(request = {}, screenFacts = [], steps = []) {
  const asked = requestedFaqOperationalText(request);
  return FAQ_TASKS.flatMap(([task, requested, visible]) => {
    if (!requested.test(asked)) return [];
    const relevant = screenFacts.filter((fact) => fact.text && visible.test(fold(`${fact.text} ${fact.subject ?? ''}`))
      && ['action', 'field', 'upload', 'destination', 'text'].includes(fact.kind));
    if (!relevant.length) return [];
    const covered = steps.some((step) => step.citations?.some((cite) => relevant.some((fact) =>
      !cite.source && cite.repository === fact.repository && cite.path === fact.path && cite.sha === fact.sha
        && cite.lineStart <= fact.lineStart && fact.lineEnd <= cite.lineEnd)));
    return covered ? [] : [`tarefa sem passo: ${task}`];
  });
}

export function missingFreeFaqTaskSteps(request = {}, screenFacts = [], tasks = []) {
  const asked = requestedFaqOperationalText(request);
  return FAQ_TASKS.flatMap(([task, requested, visible]) => {
    if (!requested.test(asked)) return [];
    const relevant = screenFacts.filter((fact) => fact.text && visible.test(fold(`${fact.text} ${fact.subject ?? ''}`))
      && ['action', 'field', 'upload', 'destination', 'text'].includes(fact.kind));
    const covered = tasks.some((entry) => requested.test(fold(entry.tarefa ?? ''))
      && entry.passos?.some((step) => relevant.length
        ? relevant.some((fact) => hasLabel(step.text ?? '', fact.text))
        : String(step.text ?? '').trim().length > 0));
    return covered ? [] : [`tarefa sem passo: ${task}`];
  });
}

export function classifyFaqQuestions(questions = [], _request = {}, screenFacts = null) {
  const blocking = [], pending = [];
  const hasTaskFacts = hasFaqTaskFacts(screenFacts);
  for (const question of questions) {
    const q = String(question);
    (!hasTaskFacts && /\b(?:como (?:entrar|abrir|acessar|começar|iniciar|salvar|confirmar|cadastrar|criar)|onde (?:fica|está|clicar)|qual (?:tela|botão|menu)|resposta direta|passo (?:principal|inicial))\b/iu.test(q)
      ? blocking : pending).push(q);
  }
  if (screenFacts !== null && !hasTaskFacts && !blocking.length && questions.length) {
    blocking.push(...pending.splice(0));
  }
  return { blocking, pending };
}

export async function loadBusinessContext(pilotRoot, module, directory = process.env.BUSINESS_CONTEXT_DIR, { log = () => {} } = {}) {
  if (!directory) return [];
  if (!(await stat(directory).catch(() => null))?.isDirectory()) return [];
  const names = await readdir(directory).catch(() => []);
  const result = [];
  const moduleSlug = module && fold(module).replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  for (const name of names.sort()) {
    const path = `business-context/${name}`;
    if (!BUSINESS_PATH.test(path) || (moduleSlug && name !== 'geral.md' && name !== `${moduleSlug}.md`)) continue;
    const absolute = join(directory, name);
    if (!(await lstat(absolute)).isFile()) continue;
    const body = await readFile(absolute, 'utf8');
    if (!/^(?:>\s*)?🟢\s*(?:\*\*)?PÚBLICO\b/mu.test(body)) {
      log(`Contexto ignorado: ${name} (sem cabeçalho público)`);
      continue;
    }
    if (/🟡|🔴|\b(?:INTERNO|CONFIDENCIAL)\b/iu.test(body)) {
      log(`Contexto ignorado: ${name} (conteúdo interno)`);
      continue;
    }
    if (containsSensitiveData(body, { detectOpaque: true })) {
      const kinds = sensitiveKinds(body, { detectOpaque: true });
      const reason = kinds.internal ? 'host interno' : kinds.personal ? 'dado pessoal'
        : kinds.credential ? 'segredo' : 'dado sensível';
      log(`Contexto ignorado: ${name} (${reason})`);
      continue;
    }
    result.push({ path, module, body: redactSensitiveData(body) });
  }
  return result;
}

export async function selectFaqStyleExamples(docsRoot) {
  const names = (await readdir(docsRoot, { recursive: true }).catch(() => []))
    .filter((name) => name.endsWith('.mdx')).sort();
  const examples = [];
  for (const name of names) {
    const raw = await readFile(join(docsRoot, name), 'utf8');
    const front = raw.match(/^---\n([\s\S]*?)\n---/u);
    if (!front) continue;
    let fields;
    try { fields = parse(front[1]); } catch { continue; }
    if (fields?.contentType !== 'faq' || !['produto', 'suporte'].includes(fields.source)) continue;
    const body = raw.slice(front[0].length).replace(/```[\s\S]*?```/gu, '').replace(/<[^>]+>/gu, '');
    const sections = [...body.matchAll(/^##\s+(.+)$/gmu)].map((item) => item[1]);
    const steps = [...body.matchAll(/^\s*\d+[.)]\s+/gmu)].length;
    const examplesCount = [...body.matchAll(/\bexemplos?\b/giu)].length;
    const prose = body.split('\n').map((line) => line.trim()).filter(Boolean);
    const direct = prose.find((line) => !/^#|^\d+[.)]\s/u.test(line)) ?? '';
    const stepText = prose.filter((line) => /^\d+[.)]\s/u.test(line)).slice(0, 3);
    const example = prose.find((line) => /\bexemplo\b/iu.test(line)) ?? '';
    examples.push({ path: `docs/${name.replace(/\.mdx$/u, '')}`, sections: sections.length,
      steps, examples: examplesCount,
      style: redactSensitiveData(`Resposta: ${direct}\nPassos: ${stepText.join(' | ')}\nExemplo: ${example}`.slice(0, 900)) });
  }
  return examples.sort((a, b) => b.sections - a.sections || b.examples - a.examples
    || b.steps - a.steps || a.path.localeCompare(b.path)).slice(0, 3);
}

// M5.58 owns extraction. This adapter accepts only its public fact shape.
export function adaptScreenFacts(screen = {}, coverage = []) {
  return (screen.facts ?? []).flatMap((fact) => {
    const match = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.source ?? '');
    if (!match || !['route', 'action', 'field', 'column', 'upload', 'uploadLimit',
      'validation', 'message', 'destination', 'guard', 'text', 'state'].includes(fact.kind)) return [];
    const menuFallback = fact.kind === 'route' && !fact.routeTitle
      ? coverage.find((item) => item.productRoutes?.includes(fact.route))?.module : null;
    const base = { ...fact, ...(menuFallback ? { routeTitle: fact.text, text: menuFallback } : {}),
      repository: fact.repository ?? 'ihelpchat/front-react',
      path: match[1], lineStart: Number(match[2]), lineEnd: Number(match[2]), sha: fact.sha ?? screen.sha };
    const qualifier = fact.required === true ? 'obrigatório' : fact.required === false ? 'opcional' : null;
    const presence = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? fact.source ?? '');
    if (['field', 'column'].includes(fact.kind) && fact.text)
      base.claimText = qualifier && fact.validationSource === undefined ? `${fact.text} ${qualifier}` : fact.text;
    const message = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? fact.source ?? '');
    if (base.kind === 'text' && base.property === 'placeholder') base.kind = 'field';
    return [base, ...(qualifier && fact.kind === 'field' && fact.validationSource && presence ? [{ ...base,
      claimText: `${fact.text} ${qualifier}${fact.message ? ` ${fact.message}` : ''}`,
      path: presence[1], lineStart: Number(presence[2]), lineEnd: Number(presence[2]) }] : []),
    ...(fact.kind === 'field' && fact.message && message ? [{ ...base, kind: 'message',
      text: fact.message, claimText: fact.message, path: message[1], lineStart: Number(message[2]), lineEnd: Number(message[2]) }] : [])];
  });
}

export const indexedFaqFacts = (screenFacts = []) => screenFacts.map((fact, index) =>
  ({ ...fact, id: `f${index + 1}` }));

const FAQ_FACT_ACTIONS = {
  abrir: new Set(['route', 'destination']), clicar: new Set(['action']),
  preencher: new Set(['field', 'upload']), selecionar: new Set(['field', 'column']),
  conferir: new Set(['state', 'message', 'validation']),
};
const factCitation = ({ repository, path, lineStart, lineEnd, sha }) =>
  ({ repository, path, lineStart, lineEnd, sha });
const safeLabel = (value) => normalized(value).replace(/&/gu, '&amp;')
  .replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/([\\*\[\]])/gu, '\\$1');
const sentence = (value) => `${value.replace(/[.!?]+$/u, '')}.`;

function structuredFaqStep(step, facts, context, pending, { correction = false } = {}) {
  if (!step || typeof step !== 'object' || Array.isArray(step)
    || Object.keys(step).some((key) => !['acao', 'fato', 'resultado', 'observacao'].includes(key))
    || !FAQ_FACT_ACTIONS[step.acao]?.has(facts.find((fact) => fact.id === step.fato)?.kind)) return null;
  const fact = facts.find((item) => item.id === step.fato);
  if (!fact?.text || !fact.repository || !fact.path || !fact.sha || !Number.isInteger(fact.lineStart)) return null;
  if (step.acao === 'conferir' && fact.kind === 'state' && facts.some((item) =>
    item.kind === 'action' && fold(item.text) === fold(fact.text))) return null;
  const result = step.resultado == null ? null : facts.find((item) => item.id === step.resultado);
  if (step.resultado != null && (!result || !['message', 'validation'].includes(result.kind)
    || !result.text || !result.repository || !result.path || !result.sha)) return null;
  const label = safeLabel(fact.text);
  if (!label || label.length > 80) return null;
  const verb = { abrir: 'Abra', clicar: 'Clique em', preencher: 'Preencha',
    selecionar: 'Escolha', conferir: 'Confira' }[step.acao];
  let body = `${verb} **${label}**`;
  const citations = [factCitation(fact)];
  if (step.acao === 'preencher' && fact.required === true) {
    body += ' (obrigatório)';
    const source = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? '');
    const presence = source && facts.find((item) => item.kind === 'field' && item.text === fact.text
      && item.claimText?.includes('obrigatório') && item.path === source[1]
      && item.lineStart === Number(source[2]));
    if (fact.validationSource && !presence) return null;
    if (presence) citations.push(factCitation(presence));
  }
  body = sentence(body);
  if (result) { body += ` A tela mostra **${safeLabel(result.text)}**.`; citations.push(factCitation(result)); }
  if (step.observacao != null) {
    const observation = step.observacao;
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)
      || Object.keys(observation).some((key) => !['text', 'citations'].includes(key))
      || typeof observation.text !== 'string' || !normalized(observation.text)
      || observation.text.length > 160 || !Array.isArray(observation.citations) || !observation.citations.length
      || actionVerbs(observation.text).length) return null;
    const checked = validateFaqSections({ suporte: [observation] }, context);
    if (!checked.sections.suporte?.length) {
      pending.push(...checked.pending.filter((item) => item.startsWith('palavra sem fonte:')));
      return null;
    }
    body += ` ${observation.text.trim()}`;
    citations.push(...observation.citations);
  }
  return { text: correction ? body[0].toLocaleLowerCase('pt-BR') + body.slice(1) : body, citations };
}

function structuredFaqError(error, facts, context, pending) {
  if (!error || typeof error !== 'object' || Array.isArray(error)
    || Object.keys(error).some((key) => !['mensagem', 'corrigir'].includes(key))) return null;
  const fact = facts.find((item) => item.id === error.mensagem);
  if (!fact || !['validation', 'message'].includes(fact.kind) || !fact.text
    || !fact.repository || !fact.path || !fact.sha) return null;
  const correction = error.corrigir == null ? null
    : structuredFaqStep(error.corrigir, facts, context, pending, { correction: true });
  if (error.corrigir != null && !correction) return null;
  return { text: `Se aparecer **${safeLabel(fact.text)}**, ${correction?.text ?? 'confira a mensagem na tela.'}`,
    citations: [factCitation(fact), ...(correction?.citations ?? [])] };
}

export function validateFaqSections(sections, context) {
  const citedFacts = (cite) => (context.screenFacts ?? []).filter((fact) =>
    cite.repository === fact.repository && cite.path === fact.path && cite.sha === fact.sha
      && Number.isInteger(cite.lineStart) && Number.isInteger(cite.lineEnd)
      && cite.lineStart > 0 && cite.lineEnd >= cite.lineStart && cite.lineEnd - cite.lineStart < 30
      && cite.lineStart <= fact.lineStart && fact.lineEnd <= cite.lineEnd);
  const kept = {}, pending = [];
  const indexedFacts = indexedFaqFacts(context.screenFacts ?? []);
  for (const key of Object.keys(FAQ_SECTIONS)) {
    const units = sections?.[key] ?? [];
    if (!Array.isArray(units) || !units.length) { pending.push(`seção sem fonte: ${FAQ_SECTIONS[key]}`); continue; }
    if (key === 'passos' || key === 'erros') {
      const valid = units.map((unit) => {
        if (key === 'passos' && unit?.acao === 'conferir'
          && indexedFacts.find((fact) => fact.id === unit.fato)?.kind === 'field')
          pending.push('ação incompatível: conferir em campo de texto; use preencher');
        return { unit, rendered: key === 'passos'
          ? structuredFaqStep(unit, indexedFacts, context, pending)
          : structuredFaqError(unit, indexedFacts, context, pending) };
      })
        .filter((item) => {
          if (!mentionsSource(item.rendered?.text)) return Boolean(item.rendered);
          pending.push(`${FAQ_SECTIONS[key]}: menção à fonte`);
          return false;
        });
      if (valid.length) {
        if (key === 'passos') {
          const distinct = [];
          let lastStep = null, opened = null;
          for (const { unit, rendered } of valid) {
            const fact = indexedFacts.find((item) => item.id === unit.fato);
            const identity = `${unit.acao}:${fact?.kind}:${fact?.route ?? ''}:${fact?.text ?? ''}`;
            if (identity === lastStep) continue;
            if (unit.acao === 'abrir') {
              const screen = fact?.text;
              if (screen === opened) continue;
              opened = screen;
            }
            distinct.push(rendered);
            lastStep = identity;
          }
          if (distinct.length) kept[key] = distinct;
        } else kept[key] = valid.map((item) => item.rendered);
      }
      if (valid.length !== units.length || !valid.length) pending.push(`seção sem fonte válida: ${FAQ_SECTIONS[key]}`);
      continue;
    }
    const valid = units.filter((unit) => {
      if (!unit || typeof unit.text !== 'string' || !normalized(unit.text)) return false;
      if (mentionsSource(unit.text)) { pending.push(`${FAQ_SECTIONS[key]}: menção à fonte`); return false; }
      if (key !== 'resposta' && FAQ_PROCEDURAL_IMPERATIVE.test(unit.text)) return false;
      if (/\b(?:pedido|sinal agregado|fonte|nao esta descrito|nao estao descritos)\b/u.test(fold(unit.text))) {
        pending.push(`metanarração em ${unit.text}`);
        return false;
      }
      if (!Array.isArray(unit.citations) || !unit.citations.length) return false;
      if (key === 'exemplo' && !unit.text.includes(valueFor({ name: 'nome' }))) return false;
      if ((key === 'paraQueServe' || key === 'quandoUsar')
        && !unit.citations.some((cite) => ['negocio', 'pagina', 'pedido'].includes(cite.source))) return false;
      // M5.58 represents missing or conflicting presence evidence as unknown.
      // Neither a support quote nor a validation message may override that state.
      if ((context.screenFacts ?? []).some((fact) => ['field', 'column'].includes(fact.kind)
        && fact.text && hasLabel(unit.text, fact.text)
        && ((fact.required !== true && /\bobrigatóri[oa]s?\b/iu.test(unit.text))
          || (fact.required !== false && /\bopciona(?:l|is)\b/iu.test(unit.text))))) return false;
      const citationsValid = unit.citations.every((cite) => {
        if (key === 'duvidas' && cite.source !== 'suporte') return false;
        if (cite.source === 'pedido') return literal(cite.quote, `${context.request?.description ?? ''}\n${context.request?.details ?? ''}`);
        if (cite.source === 'pagina') {
          const page = context.existing?.find((item) => item.path === cite.path);
          return Boolean(page && literal(cite.quote, `${page.title ?? ''}\n${page.description ?? ''}\n${page.body ?? ''}`));
        }
        if (cite.source === 'suporte') return (context.support?.categories ?? []).some((item) =>
          literal(cite.quote, `${item.category}\n${item.guidance}`))
          || (context.support?.rules ?? []).some((rule) => literal(cite.quote, rule));
        if (cite.source === 'negocio') return BUSINESS_PATH.test(cite.path ?? '')
          && (context.business ?? []).some((item) => item.path === cite.path && literal(cite.quote, item.body));
        return citedFacts(cite).length > 0;
      });
      if (!citationsValid) return false;
      const sources = unit.citations.map((cite) => {
        if (cite.source) return cite.quote;
        return citedFacts(cite).map((fact) => fact.claimText ?? fact.text ?? '').join(' ');
      });
      const screenLabels = (context.screenFacts ?? []).filter((fact) => fact.text
        && fact.text.length <= 80 && !/[.!?]/u.test(fact.text) && hasLabel(unit.text, fact.text))
        .map((fact) => fact.text);
      const uncovered = supportedClaim(unit.text, [...sources, ...screenLabels],
        { example: key === 'exemplo', request: context.request,
          lexical: !(key === 'resposta'
            && unit.text === deterministicFaqAnswer(context.request, context.screenFacts)?.text) });
      if (!uncovered.length) return true;
      pending.push(`palavra sem fonte: ${uncovered.join(', ')} em ${unit.text}`);
      return false;
    });
    if (valid.length) kept[key] = valid;
    if (valid.length !== units.length || !valid.length) pending.push(`seção sem fonte válida: ${FAQ_SECTIONS[key]}`);
  }
  return { sections: kept, pending: [...new Set(pending)], blocking: [...CORE].filter((key) => !kept[key]) };
}

export function renderFaqSections(sections) {
  return Object.entries(FAQ_SECTIONS).flatMap(([key, title]) => {
    const units = sections[key];
    if (!units?.length) return [];
    if (key === 'resposta') return [units.map((unit) => unit.text.trim()).join(' ')];
    if (key === 'passos') return [`## ${title}\n\n${units.map((unit, index) => `${index + 1}. ${unit.text.trim()}`).join('\n')}`];
    return [`## ${title}\n\n${units.map((unit) => unit.text.trim()).join('\n\n')}`];
  }).join('\n\n');
}

export function fixedFaqSupportSection(request, screenFacts = []) {
  const topic = normalized(request.topic);
  const screen = screenFacts.find((fact) => fact.kind === 'route' && fact.text)?.text;
  const location = screen && screen.length <= 80 ? screen : topic;
  const menuModule = faqModuleName(request, screenFacts);
  const place = menuModule ? `no módulo ${menuModule}` : `na tela ${location}`;
  return [{ text: `Se não conseguir concluir um passo ${place}, fale com o suporte. Informe qual passo tentou e o que apareceu na tela.`, citations: [] }];
}

export const FREE_FAQ_SECTIONS = {
  oQueE: 'O que é', paraQueServe: 'Para que serve', casosDeUso: 'Casos de uso',
  passos: 'Passo a passo', duvidas: 'Dúvidas comuns', erros: 'Erros comuns e o que fazer',
  suporte: 'Quando falar com o suporte',
};
const destructiveVerbs = (text) => actionVerbs(text).filter((verb) => FAQ_DESTRUCTIVE_VERBS.includes(verb));
export const isUnsafeCaptureAction = (text) => destructiveVerbs(text).length > 0
  || /\b(?:salvar|salve|publicar|publique|importar|importe|exportar|exporte|confirmar|confirme|enviar|envie|criar|crie|cadastrar|cadastre|ativar|ative|finalizar|finalize|transferir|transfira)\b/iu.test(text);
const faqAllowedHosts = new Set(['app.tango.us', 'apiv3.ihelpchat.com', 'ihelpchat.com.br', 'www.ihelpchat.com.br']);
const freeUnits = (sections) => Object.entries(FREE_FAQ_SECTIONS).flatMap(([key]) => key === 'passos'
  ? (sections?.passos ?? []).flatMap((task) => task?.passos ?? [])
  : sections?.[key] ?? []);
// Punctuation inside Markdown spans belongs to the span, not to a sentence boundary.
const markdownSpan = /\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|_[^_\n]+_|`[^`\n]+`|!?\[[^\]\n]+\]\([^\s)]+\)/gu;
export function splitClaims(text) {
  const source = String(text);
  const protectedUntil = Array(source.length).fill(false);
  for (const match of source.matchAll(markdownSpan))
    for (let index = match.index; index < match.index + match[0].length; index++) protectedUntil[index] = true;
  const claims = [];
  let start = 0;
  for (let index = 0; index < source.length; index++) {
    if (protectedUntil[index] || !/[.!?]/u.test(source[index])) continue;
    while (index + 1 < source.length && !protectedUntil[index + 1] && /[.!?]/u.test(source[index + 1])) index++;
    if (index + 1 < source.length && !/\s/u.test(source[index + 1])) continue;
    const part = source.slice(start, index + 1).trim();
    if (part) claims.push(part);
    start = index + 1;
  }
  const last = source.slice(start).trim();
  if (last) claims.push(last);
  return claims;
}
export function shortFreeFaqTasks(tasks = [], screenFacts = [], menuModule = null) {
  return tasks.flatMap((task) => {
    if (!task.passos?.length) return [];
    const issues = [];
    const first = task.passos[0].text ?? '';
    if (menuModule && (!/\b(?:módulo|menu)\b/iu.test(first) || !fold(first).includes(fold(menuModule))))
      issues.push(`passo a passo sem ponto de partida em ${task.tarefa}`);
    const matching = screenFacts.filter((fact) => fold(fact.subject ?? '').includes(fold(task.tarefa ?? ''))
      && ['action', 'field', 'upload', 'destination'].includes(fact.kind));
    const changesState = /\b(?:cadastr|cri|edit|agend|import|public|ativ|export|salv|exclu)/iu.test(task.tarefa ?? '');
    if (task.passos.length === 1 && (matching.length > 1 || changesState))
      issues.push(`passo a passo curto em ${task.tarefa}`);
    const completion = matching.find((fact) => fact.kind === 'action' && /^(?:salvar|importar|publicar|concluir|confirmar|agendar)$/iu.test(fact.text));
    if (completion && !task.passos.some((step) => hasLabel(step.text ?? '', completion.text)))
      issues.push(`passo a passo sem confirmação em ${task.tarefa}`);
    if (changesState && !completion && task.passos.length > 1)
      issues.push(`confirmação sem fatos do fluxo em ${task.tarefa}`);
    return issues;
  });
}
const FAQ_METANARRATION = /\b(?:pedido|material|fonte|confirmad\w*|presumir|supondo|neste texto|aqui n[aã]o)\b/iu;
const cleanFaqMeta = (text, pending) => splitClaims(text).filter((phrase) => {
  if (!FAQ_METANARRATION.test(phrase)) return true;
  pending.push(`metanarração: ${phrase}`);
  return false;
}).join(' ');
export const trimFaqLabels = (text) => text.replace(/\*\*([^*\n]+)\*\*/gu, (_match, label) => `**${label.trim()}**`);

function withoutSourceAttribution(phrase, context) {
  const introductory = phrase.match(/^(segundo|conforme|de acordo com|com base (?:em|no|na|nos|nas)|a partir (?:de|do|da|dos|das)|pelo que consta em|como (?:indicado|descrito|mencionado) em)\s+([^,]+),\s*(.+)$/iu);
  const prefix = phrase.match(/^(.+?)\s+mostra que\s+(.+)$/iu);
  const candidate = introductory && mentionsSource(`${introductory[1]} ${introductory[2]}`)
    ? introductory[3] : prefix && mentionsSource(`Segundo ${prefix[1]}`) ? prefix[2] : '';
  const clean = candidate.charAt(0).toLocaleUpperCase('pt-BR') + candidate.slice(1);
  return clean && splitClaims(clean).length === 1 && !mentionsSource(clean)
    && !rigidFaqIssue(clean, context) ? clean : null;
}

function cleanSourceSentences(text, context, pending) {
  return splitClaims(text).flatMap((phrase) => {
    if (!mentionsSource(phrase)) return [phrase];
    const clean = withoutSourceAttribution(phrase, context);
    if (clean) {
      pending.push(`${phrase} — menção à fonte; atribuição removida`);
      return [clean];
    }
    pending.push(`${phrase} — frase omitida: mencionava a fonte; reescreva só esta frase`);
    return [];
  }).join(' ');
}

function publishedStepEvidence(text, context, task, expectedLabel) {
  const requestedModule = singular(fold(context.request?.module ?? ''));
  const taskVerb = words(task).find((word) => !['como', 'de', 'do', 'da', 'o', 'a'].includes(word));
  if (!requestedModule || !taskVerb) return false;
  const labelKeys = [...String(text).matchAll(/\*\*([^*\n]+)\*\*/gu)]
    .map((match) => fold(match[1].replace(/[“”"']/gu, '').trim()));
  if (!labelKeys.length) return false;
  if (expectedLabel && !labelKeys.includes(fold(expectedLabel.replace(/[“”"']/gu, '').trim()))) return false;
  return (context.existing ?? []).some((page) => {
    if (!page.title || !(String(text).includes(page.title) || page.path && String(text).includes(page.path))) return false;
    const pageModule = page.module ? singular(fold(page.module)) : null;
    if (pageModule ? pageModule !== requestedModule
      : !words(`${page.title} ${page.path ?? ''}`).some((word) => singular(word) === requestedModule)) return false;
    const sections = String(page.body ?? '').split(/(?=^#{1,6}\s+)/mu);
    const relevant = sections.filter((section) => {
      const heading = section.match(/^#{1,6}\s+(.+)$/mu)?.[1] ?? (sections.length === 1 ? page.title : '');
      return words(heading).some((word) => faqStem(word) === faqStem(taskVerb));
    });
    return relevant.some((section) => labelKeys.every((label) => [...section.matchAll(/\*\*([^*\n]+)\*\*/gu)]
      .some((match) => fold(match[1].replace(/[“”"']/gu, '').trim()) === label)));
  });
}

function rigidFaqIssue(text, context, { useCase = false, proseLead = false } = {}) {
  if (String(text).includes('→')) return 'caso de uso com seta';
  const labels = [...String(text).matchAll(/\*\*([^*\n]+)\*\*/gu)].map((match) => match[1]);
  const labelKey = (value) => fold(String(value).replace(/[“”"']/gu, '').trim());
  const known = new Set((context.screenFacts ?? []).map((fact) => labelKey(fact.text)));
  const pages = new Set((context.existing ?? []).map((page) => labelKey(page.title)));
  const citedPages = (context.existing ?? []).filter((page) => page.title
    && (String(text).includes(page.title) || page.path && String(text).includes(page.path)));
  for (const label of labels) {
    if ((useCase || proseLead) && String(text).startsWith(`**${label}**`) && /[.!?]$/u.test(label)) continue;
    const before = String(text).slice(0, String(text).indexOf(`**${label}**`));
    const pageReference = pages.has(labelKey(label)) && /\b(?:consulte|veja|leia|guia|página)\b/iu.test(before.slice(-100));
    const publishedLabel = context.taskHeading && citedPages.length
      && publishedStepEvidence(text, context, context.taskHeading, label);
    if (!known.has(labelKey(label)) && !pageReference && !publishedLabel) return `rótulo inexistente: ${label}`;
  }
  const outsideLabels = String(text).replace(/\*\*[^*\n]+\*\*/gu, ' ');
  if (destructiveVerbs(outsideLabels).length) return 'ação destrutiva fora de rótulo da tela';
  for (const label of labels) if (destructiveVerbs(label).length
    && !(context.screenFacts ?? []).some((fact) => fact.kind === 'action' && labelKey(fact.text) === labelKey(label)))
    return `ação destrutiva sem fato: ${destructiveVerbs(label)[0]}`;
  if (containsSensitiveData(text, { detectOpaque: true })) return 'dado pessoal ou segredo';
  for (const match of String(text).matchAll(/https?:\/\/[^\s)\]>]+/giu)) {
    let url;
    try { url = new URL(match[0].replace(/[.,;!?]+$/u, '')); } catch { return 'host inválido'; }
    if (url.protocol !== 'https:' || !faqAllowedHosts.has(url.hostname) || url.username || url.password || url.port)
      return 'host fora da lista';
  }
  if (/\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM)\b|\[trecho de código interno omitido\]|```|\b(?:DTO|repository|service)\b/iu.test(text))
    return 'código interno';
  return null;
}

export function validateFreeFaqSections(sections, context = {}) {
  const kept = {}, pending = [], blocking = [];
  const taskContext = (units, heading, field) => (Array.isArray(units) ? units : []).flatMap((unit) => {
    const text = typeof unit?.text === 'string' ? trimFaqLabels(cleanFaqMeta(cleanSourceSentences(unit.text, context, pending), pending)) : '';
    const issue = text ? rigidFaqIssue(text, context) : 'frase vazia';
    if (issue) { pending.push(`${heading} ${field}: ${issue}`); return []; }
    return [{ ...unit, text }];
  }).slice(0, 2);
  for (const key of Object.keys(FREE_FAQ_SECTIONS)) {
    if (key === 'passos') {
      kept.passos = (sections?.passos ?? []).flatMap((task) => {
        if (!task || typeof task.tarefa !== 'string' || !Array.isArray(task.passos)) return [];
        const heading = task.tarefa.replace(/^#+\s*/u, '').trim();
        const headingIssue = !/^[\p{L}\p{N}() ,\/-]{1,80}$/u.test(heading)
          ? 'título de tarefa inválido' : mentionsSource(heading) ? 'menção à fonte' : rigidFaqIssue(heading, context);
        if (headingIssue) { pending.push(`${heading}: ${headingIssue}`); return []; }
        const citedPublishedPage = task.passos.some((unit) => publishedStepEvidence(unit?.text ?? '', context, heading));
        if (!citedPublishedPage && faqTasksWithoutFacts(context.request, context.screenFacts).some((name) => fold(name) === fold(heading))) {
          pending.push(`tarefa sem fatos de tela: ${heading}`);
          return [];
        }
        const steps = task.passos.flatMap((unit) => {
          const text = typeof unit?.text === 'string' ? trimFaqLabels(cleanFaqMeta(cleanSourceSentences(unit.text, context, pending), pending)) : '';
          const issue = text
            ? rigidFaqIssue(text, { ...context, taskHeading: heading }) : 'passo vazio';
          if (issue) { pending.push(`${task.tarefa}: ${issue}`); return []; }
          return [{ ...unit, text }];
        });
        if (!steps.length && task.passos.length) pending.push(`tarefa sem passo válido: ${task.tarefa}`);
        if (!steps.length) return [];
        const sobre = taskContext(task.sobre, heading, 'sobre');
        const depois = taskContext(task.depois, heading, 'depois');
        if (!sobre.length && !depois.length) pending.push(`contexto da tarefa ${heading} sem fonte`);
        else {
          if (!sobre.length) pending.push(`sobre da tarefa ${heading} sem fonte — a confirmar`);
          if (!depois.length) pending.push(`depois da tarefa ${heading} sem fonte — a confirmar`);
        }
        return [{ tarefa: heading, sobre, passos: steps, depois }];
      });
      continue;
    }
    kept[key] = (sections?.[key] ?? []).flatMap((unit) => {
      const text = typeof unit?.text === 'string' ? trimFaqLabels(cleanFaqMeta(cleanSourceSentences(unit.text, context, pending), pending)) : '';
      const issue = text
        ? rigidFaqIssue(text, context, { useCase: key === 'casosDeUso', proseLead: key === 'duvidas' || key === 'erros' }) : 'frase vazia';
      if (issue) { pending.push(`${FREE_FAQ_SECTIONS[key]}: ${issue}`); return []; }
      if (key === 'duvidas' && !faqQuestionAnswered(text)) {
        pending.push(`Dúvidas comuns: pergunta sem resposta: ${text}`);
        return [];
      }
      return [{ ...unit, text }];
    });
  }
  if (!kept.passos.length) blocking.push('passos ausentes');
  return { sections: kept, pending: [...new Set(pending)], blocking: [...new Set(blocking)] };
}

const faqQuestionAnswered = (text) => {
  const parts = splitClaims(String(text).replace(/\*\*([^*]+)\*\*/gu, '$1'));
  const question = parts.findIndex((part) => part.endsWith('?'));
  return question < 0 || parts.slice(question + 1).some((part) => part.replace(/<\/?AConfirmar>/gu, '').trim());
};

export function missingFaqSupportSections(sections, context = {}) {
  const facts = context.screenFacts ?? [];
  const business = context.business ?? [];
  const hasError = facts.some((fact) => /\b(?:nenhum|erro|falha|vazi[oa]|n[aã]o encontrad[oa]|inv[aá]lid[oa])\b/iu.test(fact.text ?? ''));
  const hasQuestion = business.some((item) => /\?|\bd[uú]vida\b/iu.test(item.body ?? ''));
  return [hasQuestion && !(sections.duvidas ?? []).length ? 'Dúvidas comuns' : null,
    hasError && !(sections.erros ?? []).length ? 'Erros comuns e o que fazer' : null].filter(Boolean);
}

export async function judgeClaims(sections, context, provider) {
  const claims = [];
  for (const [key] of Object.entries(FREE_FAQ_SECTIONS)) {
    const groups = key === 'passos' ? (sections.passos ?? []).flatMap((task) => [
      ['sobre', task.sobre ?? []], ['passos', task.passos ?? []], ['depois', task.depois ?? []]]) : [[key, sections[key] ?? []]];
    for (const [section, units] of groups) for (const unit of units) for (const phrase of splitClaims(unit.text))
      claims.push({ id: `c${claims.length + 1}`, section, text: phrase });
  }
  const answer = await provider(claims, context);
  if (!Array.isArray(answer?.claims) || answer.claims.length !== claims.length) throw new Error('juiz: número de frases inválido');
  const statuses = new Map();
  for (const claim of claims) {
    const verdict = answer.claims.find((item) => item.id === claim.id);
    if (!verdict || !['sustentada', 'a confirmar', 'contradiz a fonte'].includes(verdict.status)
      || typeof verdict.reason !== 'string' || verdict.reason.length > 500
      || (verdict.sourceMention !== undefined && typeof verdict.sourceMention !== 'boolean')
      || statuses.has(claim.id))
      throw new Error('juiz: claims inválidas');
    statuses.set(claim.id, verdict);
  }
  const pending = [], contradictions = [];
  let cursor = 0;
  const mark = (unit, key) => {
    const text = splitClaims(unit.text).flatMap((phrase) => {
      const claim = claims[cursor++], verdict = statuses.get(claim.id);
      // "A tela" descreve a interface do produto, não atribui a frase ao material de apoio.
      const uiBehavior = /^a tela\b/iu.test(phrase) && !mentionsSource(phrase);
      if (verdict.sourceMention && !uiBehavior) {
        const withoutAttribution = withoutSourceAttribution(phrase, context);
        if (!withoutAttribution) {
          pending.push(`${phrase} — frase omitida: mencionava a fonte; reescreva só esta frase`);
          return [];
        }
        pending.push(`${phrase} — menção à fonte; atribuição removida`);
        phrase = withoutAttribution;
      }
      const noBusiness = !context.business?.some((item) => item.module === context.request?.module)
        && ['oQueE', 'paraQueServe', 'casosDeUso'].includes(key);
      const status = noBusiness && verdict.status === 'sustentada' ? 'a confirmar' : verdict.status;
      if (status === 'sustentada') return [phrase];
      const reason = noBusiness && verdict.status === 'sustentada' ? 'Contexto de negócio ausente' : verdict.reason;
      pending.push(`${phrase} — ${reason}`);
      if (status === 'contradiz a fonte') contradictions.push({ text: phrase, reason });
      return [`<AConfirmar>${phrase}</AConfirmar>`];
    }).join(' ');
    return text ? { ...unit, text } : null;
  };
  const result = {};
  const hasSupportedContext = (units) => units.some((unit) =>
    unit.text.replace(/<AConfirmar>[\s\S]*?<\/AConfirmar>/gu, '').trim().length > 0);
  for (const [key] of Object.entries(FREE_FAQ_SECTIONS)) result[key] = key === 'passos'
    ? (sections.passos ?? []).map((task) => {
      const sobre = (task.sobre ?? []).map((unit) => mark(unit, 'sobre')).filter(Boolean);
      const passos = task.passos.map((unit) => mark(unit, key)).filter(Boolean);
      const depois = (task.depois ?? []).map((unit) => mark(unit, 'depois')).filter(Boolean);
      if (!hasSupportedContext(sobre) && !hasSupportedContext(depois)) {
        pending.push(`contexto da tarefa ${task.tarefa} sem fonte`);
        return { ...task, sobre: [], passos, depois: [] };
      }
      return { ...task, sobre, passos, depois };
    })
      .filter((task) => task.passos.length)
    : (sections[key] ?? []).map((unit) => mark(unit, key)).filter(Boolean);
  result.duvidas = result.duvidas.filter((unit) => {
    if (faqQuestionAnswered(unit.text) && !/<AConfirmar>/u.test(unit.text)) return true;
    pending.push(`Dúvidas comuns: pergunta sem resposta: ${unit.text}`);
    return false;
  });
  return { sections: result, pending, contradictions,
    verdicts: claims.map((claim) => ({ text: claim.text, ...statuses.get(claim.id) })) };
}

export function renderFreeFaqSections(sections) {
  return Object.entries(FREE_FAQ_SECTIONS).flatMap(([key, title]) => {
    if (key === 'passos') return (sections.passos ?? []).length ? [`## ${title}\n\n${sections.passos.map((task) =>
      [`### ${String(task.tarefa).replace(/^#+\s*/u, '').trim()}`,
        ...(task.sobre?.length ? [task.sobre.map((unit) => trimFaqLabels(unit.text)).join(' ')] : []),
        task.passos.map((unit, index) => `${index + 1}. ${trimFaqLabels(unit.text)}`).join('\n'),
        ...(task.depois?.length ? [`**O que acontece depois:** ${task.depois.map((unit) => trimFaqLabels(unit.text)).join(' ')}`] : [])]
        .join('\n\n')).join('\n\n')}`] : [];
    const units = sections[key] ?? [];
    return units.length ? [`## ${title}\n\n${units.map((unit) => unit.text).join('\n\n')}`] : [];
  }).join('\n\n');
}

const fidelityText = (value) => plainMarkdownText(String(value ?? '').replace(/<\/?AConfirmar>/gu, ''))
  .replace(/\s+/gu, ' ').trim();

export function faqAssemblyLosses(approved, body) {
  const rendered = new Map([...String(body).matchAll(/^## (.+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gmu)]
    .map((match) => [match[1], fidelityText(match[2])]));
  const losses = [];
  for (const [key, title] of Object.entries(FREE_FAQ_SECTIONS)) {
    const units = key === 'passos' ? (approved.passos ?? []).flatMap((task) => [
      ...(task.sobre ?? []), ...(task.passos ?? []), ...(task.depois ?? []),
    ]) : approved[key] ?? [];
    for (const unit of units) for (const phrase of splitClaims(fidelityText(unit.text))) {
      if (!rendered.get(title)?.includes(phrase))
        losses.push(`perda na montagem: ${title}: ${phrase.slice(0, 80)}`);
    }
  }
  return [...new Set(losses)];
}
