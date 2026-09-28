import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { redactSensitiveData, containsSensitiveData } from './sensitive-data.mjs';
import { valueFor } from './api-synthetic-example.mjs';
import { FAQ_NEUTRAL_WORDS, FAQ_NEUTRAL_VERBS } from './faq-neutral-words.mjs';
import { faqStem } from './faq-portuguese-stem.mjs';

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
const FAQ_ACTION_VERBS = [...new Set([
  ...FAQ_NAVIGATION_VERBS,
  'apagar', 'excluir', 'remover', 'deletar', 'destruir', 'limpar', 'desativar',
  'desconectar', 'cancelar', 'bloquear', 'resetar', 'zerar',
  'criar', 'adicionar', 'salvar', 'enviar', 'ativar', 'editar', 'importar',
  'exportar', 'publicar', 'agendar', 'configurar', 'cadastrar', 'vincular',
  'transferir', 'finalizar',
])];
const FAQ_VERB_FORMS = new Map(FAQ_ACTION_VERBS.map((verb) => [verb, new Set([
  // Primeira pessoa em -o coincide com substantivos de interface (cadastro, bloqueio).
  ...verbForms(verb).filter((form) => form !== `${fold(verb).slice(0, -2)}o`), ...({
    apagar: ['apague', 'apaguem'], bloquear: ['bloqueie', 'bloqueiem'],
    clicar: ['clique', 'cliquem'], excluir: ['exclua', 'excluam', 'exclui'],
    publicar: ['publique', 'publiquem'], localizar: ['localize', 'localizem'],
    ver: ['veja', 'vejam', 'vejo', 've', 'veem'],
  }[verb] ?? []),
])]));
const actionVerbs = (text) => [...new Set(words(text).flatMap((word) =>
  [...FAQ_VERB_FORMS].filter(([, forms]) => forms.has(word)).map(([verb]) => verb)))];
const FAQ_PROCEDURAL_IMPERATIVE = /\b(?:abra|clique|toque|preencha|digite|escolha|selecione|confira|apague|exclua|destrua|remova|delete|limpe|desative|desconecte|cancele|bloqueie|resete|zere|crie|adicione|salve|envie|ative|edite|importe|exporte|publique|agende|configure|cadastre|vincule|transfira|finalize)\b/iu;
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

// The direct answer is assembled from requested tasks backed by screen facts.
export function deterministicFaqAnswer(request = {}, screenFacts = []) {
  const screenFact = screenFacts.find((fact) => fact.kind === 'route' && fact.text)
    ?? screenFacts.find((fact) => fact.text && hasLabel(fact.text, request.topic));
  const screen = screenFact?.kind === 'route' ? screenFact.text : screenFact ? request.topic : null;
  const asked = fold(`${request.description ?? ''} ${request.details ?? ''}`);
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
  return { text: `Na tela **${screen}**, você pode ${list}.`,
    citations: [...new Map(citations.map((cite) => [JSON.stringify(cite), cite])).values()] };
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

export function missingFaqTaskSteps(request = {}, screenFacts = [], steps = []) {
  const asked = fold((request.details ?? request.description ?? '').split(/\bcobrir\b/iu).at(-1));
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

export async function loadBusinessContext(pilotRoot) {
  const directory = join(pilotRoot, 'architecture', 'business-context');
  if (!(await lstat(directory).catch(() => null))?.isDirectory()) return [];
  const names = await readdir(directory).catch(() => []);
  const result = [];
  for (const name of names.sort()) {
    const path = `business-context/${name}`;
    if (!BUSINESS_PATH.test(path)) continue;
    const absolute = join(directory, name);
    if (!(await lstat(absolute)).isFile()) continue;
    const body = await readFile(absolute, 'utf8');
    if (!/^🟢\s*PÚBLICO\b/mu.test(body) || /🟡|🔴|\b(?:INTERNO|CONFIDENCIAL)\b/iu.test(body)
      || containsSensitiveData(body, { detectOpaque: true })) continue;
    result.push({ path, body: redactSensitiveData(body) });
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
export function adaptScreenFacts(screen = {}) {
  return (screen.facts ?? []).flatMap((fact) => {
    const match = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.source ?? '');
    if (!match || !['route', 'action', 'field', 'column', 'upload', 'uploadLimit',
      'validation', 'message', 'destination', 'guard', 'text', 'state'].includes(fact.kind)) return [];
    const base = { ...fact, repository: fact.repository ?? 'ihelpchat/front-react',
      path: match[1], lineStart: Number(match[2]), lineEnd: Number(match[2]), sha: fact.sha ?? screen.sha };
    const qualifier = fact.required === true ? 'obrigatório' : fact.required === false ? 'opcional' : null;
    const presence = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? fact.source ?? '');
    if (['field', 'column'].includes(fact.kind) && fact.text)
      base.claimText = qualifier && fact.validationSource === undefined ? `${fact.text} ${qualifier}` : fact.text;
    const message = /^(src\/[^:\n]+\.(?:tsx?|jsx?)):(\d+)$/u.exec(fact.validationSource ?? fact.source ?? '');
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
  conferir: new Set(['text', 'state', 'column', 'message', 'validation']),
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
      const valid = units.map((unit) => key === 'passos'
        ? structuredFaqStep(unit, indexedFacts, context, pending)
        : structuredFaqError(unit, indexedFacts, context, pending)).filter(Boolean);
      if (valid.length) kept[key] = valid;
      if (valid.length !== units.length || !valid.length) pending.push(`seção sem fonte válida: ${FAQ_SECTIONS[key]}`);
      continue;
    }
    const valid = units.filter((unit) => {
      if (!unit || typeof unit.text !== 'string' || !normalized(unit.text)) return false;
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
  return [{ text: `Se não conseguir concluir em ${location}, fale com o suporte. Informe qual passo tentou e o que apareceu na tela.`, citations: [] }];
}
