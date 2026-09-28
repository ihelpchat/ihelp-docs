import OpenAI from 'openai';
import { searchContent, validateArticle } from './content-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { readArticle } from './editorial-standard.mjs';
import { containsSensitiveData, redactSensitiveData, sensitiveKinds } from './sensitive-data.mjs';
import { sanitizeCodeForModel } from './code-hygiene.mjs';
import { catalogActions, isCatalogAction } from './product-actions.mjs';
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import { createBudgetedResponse } from './provider-budget.mjs';
import { internalTypeIssue, renderApiReference, responseFieldPath } from './api-reference-render.mjs';
import { finalizeSecurityResponse, securityReview } from './security-review.mjs';
import { extractCitedEndpoints } from './public-submit-gate.mjs';
import { contentMaxOutputTokens } from './env-compat.mjs';
import { withCodeRefreshOffer } from './code-refresh-offer.mjs';
import { guardModelOutput } from './model-output-guard.mjs';
import { PRODUCT_TERMS } from './product-terms.mjs';
import { attachScreenshotsToArticle, loadScreenshotManifest } from './screen-capture-manifest.mjs';
import { validCanonicalQuestion } from './conversational-contract.mjs';
import { classifyFaqQuestions, hasFaqTaskFacts, loadBusinessContext, selectFaqStyleExamples, adaptScreenFacts,
  validateFaqSections, renderFaqSections, fixedFaqSupportSection, deterministicFaqAnswer,
  missingFaqTaskSteps, FAQ_SECTIONS } from './faq-editorial.mjs';
import { FREE_FAQ_SECTIONS, validateFreeFaqSections, judgeClaims, renderFreeFaqSections,
  faqTasksWithoutFacts, missingFreeFaqTaskSteps } from './faq-editorial.mjs';
export { renderApiReference } from './api-reference-render.mjs';

contentMaxOutputTokens();

const CITATION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['repository', 'path', 'lineStart', 'lineEnd', 'sha'],
  properties: {
    repository: { type: 'string' }, path: { type: 'string' },
    lineStart: { type: 'integer' }, lineEnd: { type: 'integer' }, sha: { type: 'string' },
  },
};
const GROUNDING_SCHEMA = { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['text', 'citations'],
  properties: { text: { type: 'string' }, citations: { type: 'array', items: CITATION_SCHEMA } },
} };
const API_GROUNDING_SCHEMA = { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['text', 'citations'],
  properties: { text: { type: 'string' }, citations: { type: 'array', items: { anyOf: [
    CITATION_SCHEMA,
    { type: 'object', additionalProperties: false, required: ['source', 'quote'],
      properties: { source: { type: 'string', enum: ['pedido'] }, quote: { type: 'string' } } },
    { type: 'object', additionalProperties: false, required: ['source', 'path', 'quote'],
      properties: { source: { type: 'string', enum: ['pagina'] }, path: { type: 'string' }, quote: { type: 'string' } } },
  ] } } },
} };
const API_PROSE_UNIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'citations', 'refs'],
  properties: { text: { type: 'string' }, citations: API_GROUNDING_SCHEMA.items.properties.citations,
    refs: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'endpoint'], properties: { name: { type: 'string' }, endpoint: { type: 'string' } } } } } };
const publicNames = new Set(PRODUCT_TERMS.flatMap((term) => [term, ...term.split(/\s+/u)])
  .map((term) => term.toLocaleLowerCase('pt-BR')));
const isPublicName = (name) => publicNames.has(name.toLocaleLowerCase('pt-BR'));
const faqRequested = (request) => request.module !== 'api'
  && /\bfaq\b|página do faq/iu.test(`${request.topic ?? ''} ${request.description ?? ''} ${request.details ?? ''}`);
const faqMultipleTypesRequested = (request) => /\b(?:faq\s+e\s+tutorial|tutorial\s+e\s+faq|dois\s+artigos|duas\s+p[aá]ginas)\b/iu
  .test(`${request.description ?? ''} ${request.details ?? ''}`);

function proseIssues(article, endpoint, packageEndpoints = [endpoint], refs = [], globalScope = false) {
  const issues = [];
  const parameters = (globalScope ? packageEndpoints : [endpoint]).flatMap((item) => item.parameters ?? []);
  const referencedParameters = refs.flatMap((ref) => packageEndpoints.filter((item) => publicEndpointId(item) === ref.endpoint)
    .flatMap((item) => (item.parameters ?? []).filter((field) => field.name.toLowerCase() === ref.name.toLowerCase()).map((field) => field.name)));
  const parameterNames = new Set([...parameters.map((field) => field.name), ...referencedParameters]);
  const fieldNames = new Set([...parameters.filter((field) => field.in === 'body'),
    ...(endpoint.responseFields ?? [])]
    .map((field) => field.name));
  const headerNames = new Set(['Authorization', 'Content-Type']);
  const names = new Set([...parameterNames, ...fieldNames, ...headerNames, ...refs.map((ref) => ref.name)]
    .map((name) => name.toLocaleLowerCase('pt-BR')));
  const inlineNames = new Set([...parameterNames, ...fieldNames, ...refs.map((ref) => ref.name)]
    .map((name) => name.toLocaleLowerCase('pt-BR')));
  for (const route of (globalScope ? packageEndpoints : [endpoint]).flatMap((item) =>
    [item.route, ...(item.optionalAliases ?? (item.optionalAlias ? [item.optionalAlias] : []))])) {
    for (const segment of (route ?? '').split('/')) {
      if (segment) names.add(segment.replace(/^\{([^}]+)\}$/u, '$1').toLocaleLowerCase('pt-BR'));
    }
  }
  const token = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_-]*';
  const labelledNames = new RegExp(`\\b(campos?|parâmetros?|propriedades?|atributos?|chaves?|headers?|cabeçalhos?)\\s+(?:(?:o|a|os|as|um|uma|de|do|da|dos|das|no|na|em)\\s+)*((?:\\x60?${token}\\x60?)(?:\\s*(?:,|\\be\\b)\\s*\\x60?${token}\\x60?)*)`, 'giu');
  const tokens = new RegExp(token, 'gu');
  const foreign = new Set(packageEndpoints.flatMap((item) => item === endpoint ? [] : [
    ...(item.parameters ?? []).map((field) => field.name), ...(item.responseFields ?? []).map((field) => field.name),
    ...(item.route ?? '').split('/').map((segment) => segment.replace(/^\{([^}]+)\}$/u, '$1')),
  ]).filter((name) => /\p{Ll}\p{Lu}|\p{L}_\p{L}|(?=.*\p{L})(?=.*\d)/u.test(name))
    .map((name) => name.toLocaleLowerCase('pt-BR')));
  for (const value of [article.title, article.description, article.intro, ...article.notas]) {
    if (typeof value !== 'string') { issues.push('prosa inválida'); continue; }
    const typeIssue = internalTypeIssue(value);
    if (typeIssue) issues.push(typeIssue);
    for (const term of value.matchAll(/\b(?:DTO|entity|repository|service)\b/giu))
      issues.push(`termo interno na prosa: ${term[0]}`);
    const block = value.includes('```') ? value.match(/```[^\n]*/u) : null;
    if (block) issues.push(`bloco de código proibido: ${block[0].slice(0, 80)}`);
    const component = value.match(/<\/?[A-Za-z][^>]*>/u);
    if (component) issues.push(`componente proibido: ${component[0]}`);
    const path = value.match(/\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_{}-]+)*/u);
    if (path) issues.push(`caminho proibido: ${path[0]}`);
    for (const code of value.matchAll(/`([^`\n]+)`/gu)) {
      if (!inlineNames.has(code[1].toLocaleLowerCase('pt-BR'))) issues.push(`código inline proibido: ${code[0]}`);
    }
    const method = value.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\b/iu);
    if (method) issues.push(`método proibido na prosa: ${method[0]}`);
    for (const labelled of value.matchAll(labelledNames)) {
      const allowed = /^(?:campos?|propriedades?|atributos?|chaves?)$/iu.test(labelled[1])
        ? fieldNames : /^parâmetros?$/iu.test(labelled[1]) ? parameterNames : headerNames;
      for (const candidate of labelled[2].matchAll(new RegExp(`(\\x60?)(${token})\\x60?`, 'gu'))) {
        const name = candidate[2];
        const factual = [...allowed].some((fact) => fact.toLowerCase() === name.toLowerCase());
        const technical = Boolean(candidate[1]) || /(?<=\p{L})\p{Lu}|\p{L}_\p{L}|(?=.*\p{L})(?=.*\p{N})/u.test(name)
          || [...names].some((fact) => fact.toLowerCase() === name.toLowerCase());
        if (technical && !factual && !isPublicName(name)) issues.push(`nome técnico sem fato: ${name}`);
      }
    }
    for (const [name] of value.matchAll(tokens)) {
      if (!globalScope && foreign.has(name.toLocaleLowerCase('pt-BR')) && !names.has(name.toLocaleLowerCase('pt-BR')))
        issues.push(`nome de outro endpoint sem referência: ${name}`);
      const identifier = /\p{Ll}\p{Lu}|\p{L}_\p{L}/u.test(name)
        || (/\p{L}/u.test(name) && /\d/u.test(name));
      if (identifier && !names.has(name.toLocaleLowerCase('pt-BR')) && !isPublicName(name)
        && !foreign.has(name.toLocaleLowerCase('pt-BR'))) issues.push(`nome técnico sem fato: ${name}`);
    }
  }
  return [...new Set(issues)];
}
function referenceIssues(unit, endpoints, articles) {
  const issues = [];
  for (const ref of unit.refs ?? []) {
    const target = endpoints.find((item) => publicEndpointId(item) === ref.endpoint);
    const included = articles.some((item) => item.endpoint === ref.endpoint);
    const names = target && [
      ...(target.parameters ?? []).map((field) => field.name),
      ...(target.responseFields ?? []).flatMap((field) => [field.name, responseFieldPath(target, field)]),
      ...(target.route ?? '').split('/').map((segment) => segment.replace(/^\{([^}]+)\}$/u, '$1')),
    ];
    if (!target || !included || !names.some((name) => name.toLowerCase() === ref.name.toLowerCase())
      || !new RegExp(`(?<![\\p{L}\\p{N}_])${ref.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu').test(unit.text))
      issues.push(`referência inválida: ${ref.name}`);
  }
  return issues;
}
function renderUnit(unit, articles, endpoints) {
  const text = markFactNames(unit.text, endpoints);
  const links = [...new Set((unit.refs ?? []).map((ref) => ref.endpoint))].map((id) => {
    const target = articles.find((item) => item.endpoint === id);
    return `[${target.title.replace(/[\[\]()]/gu, '')}](/${target.path})`;
  });
  return links.length ? `${text.replace(/[.!?]$/u, '')} (${links.join(', ')}).` : text;
}
function markFactNames(text, endpoints) {
  const names = [...new Set(endpoints.flatMap((endpoint) => [
    ...(endpoint.parameters ?? []).map((item) => item.name),
    ...(endpoint.responseFields ?? []).map((item) => item.name),
  ]))].filter(Boolean);
  if (!names.length) return text;
  const facts = new Set(names);
  const commonWords = new Set(['contato', 'contatos', 'nome', 'numero', 'número', 'dados', 'data', 'hora',
    'usuario', 'usuário', 'usuarios', 'usuários', 'mensagem', 'mensagens', 'resposta', 'respostas',
    'erro', 'erros', 'canal', 'canais', 'campo', 'campos', 'lista', 'listas', 'tipo', 'tipos',
    'valor', 'valores', 'total', 'pagina', 'página', 'paginas', 'páginas', 'ativo', 'ativa',
    'estado', 'status', 'departamento', 'departamentos', 'telefone', 'email', 'endereco', 'endereço']);
  return String(text).split(/(`[^`]*`)/u).map((segment) => {
    if (segment.startsWith('`')) return segment;
    return segment.replace(/(?<![\p{L}\p{N}_])([\p{L}_][\p{L}\p{N}_]*)(?![\p{L}\p{N}_])/gu,
      (match, name, offset) => {
        if (!facts.has(name)) return name;
        const shape = /\p{Ll}\p{Lu}|_|\d/u.test(name);
        const labelled = /\b(?:campo|parâmetro|propriedade|cabeçalho)\s+$/iu.test(segment.slice(0, offset));
        return shape || labelled || !commonWords.has(name) ? '`' + name + '`' : name;
      });
  }).join('');
}
function apiSchemaIssue(article) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) return 'schema de prosa inválido';
  const allowed = new Set(['path', 'endpoint', 'title', 'description', 'intro', 'notas', 'responseDescriptions', 'parameterDescriptions']);
  const extra = Object.keys(article).find((key) => !allowed.has(key));
  if (extra) return `campo da IA não permitido: ${extra}`;
  const unit = (value) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => ['text', 'citations', 'refs'].includes(key))
    && typeof value.text === 'string' && Array.isArray(value.citations)
    && (value.refs === undefined || Array.isArray(value.refs) && value.refs.every((ref) => ref && typeof ref === 'object'
      && Object.keys(ref).every((key) => ['name', 'endpoint'].includes(key))
      && typeof ref.name === 'string' && typeof ref.endpoint === 'string'));
  if (typeof article.path !== 'string' || typeof article.endpoint !== 'string' || typeof article.title !== 'string'
    || !unit(article.description) || !unit(article.intro)
    || !Array.isArray(article.notas) || !article.notas.every(unit)) return 'schema de prosa inválido';
  if (!/^api\/[a-z0-9][a-z0-9/-]*$/u.test(article.path)) return `path API inválido: ${article.path}`;
  if (article.responseDescriptions !== undefined && (!Array.isArray(article.responseDescriptions)
    || !article.responseDescriptions.every((item) => typeof item?.name === 'string' && unit(item?.description)))) return 'descrições de resposta inválidas';
  if (article.parameterDescriptions !== undefined && (!Array.isArray(article.parameterDescriptions)
    || !article.parameterDescriptions.every((item) => typeof item?.name === 'string' && unit(item?.description)))) return 'descrições de parâmetro inválidas';
  return null;
}

export function validateGroundedOutput(output, context, fields) {
  return groundingIssues(output, context, fields).length === 0;
}

function proseSegments(value, semicolons = false) {
  const separator = semicolons ? /(?<=[.!?;])\s+|\n/u : /(?<=[.!?])\s+|\n/u;
  return String(value).split(separator).map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => /\p{L}/u.test(part));
}

function groundingIssues(output, context, fields) {
  if (!context.groundingRequired) return [];
  const claims = output.grounding;
  if (!Array.isArray(claims)) return ['grounding ausente'];
  const lines = fields.flatMap((field) => {
    const value = output[field];
    return (Array.isArray(value) ? value : [value]).filter((item) => typeof item === 'string')
      .flatMap((item) => proseSegments(item));
  });
  if (!lines.length) return ['frases sem grounding'];
  const issues = lines.filter((line) => !claims.some((claim) => claim.text === line)).map((line) => `frase sem citação: ${line}`);
  const normalizeSpaces = (value) => value.replace(/\s+/gu, ' ').trim();
  const segmentsOf = (quote) => proseSegments(quote, true);
  const literalSegments = (quote, sources) => {
    const segments = segmentsOf(quote);
    return normalizeSpaces(String(quote)).length >= 12 && segments.some((segment) => segment.length >= 12)
      && segments.every((segment, index) => sources.some((source) => {
        if (typeof source !== 'string') return false;
        const literal = normalizeSpaces(source).toLocaleLowerCase('pt-BR');
        const compared = segment.toLocaleLowerCase('pt-BR');
        if (literal.includes(compared)) return true;
        return index === segments.length - 1 && !/[.!?;]$/u.test(segment)
          && [...literal.matchAll(new RegExp(`${compared.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[.!?;]`, 'gu'))].length > 0;
      }));
  };
  const evidence = evidenceIndex(context);
  if (!claims.length) issues.push('grounding vazio');
  for (const claim of claims) {
    if (typeof claim.text !== 'string' || !lines.includes(claim.text)) issues.push('citação sem frase correspondente');
    if (!Array.isArray(claim.citations) || !claim.citations.length) { issues.push(`frase sem citação: ${claim.text ?? ''}`); continue; }
    for (const citation of claim.citations) {
      if (citation?.source === 'pedido') {
        if (context.module !== 'api' || !literalSegments(citation.quote ?? '', [context.request?.details, context.request?.description]))
          issues.push(`não é trecho literal do pedido: ${citation.quote ?? ''}`);
      } else if (citation?.source === 'pagina') {
        const pages = [...context.existing ?? [], ...context.apiExamples ?? []];
        const page = pages.find((item) => item.path === citation.path);
        if (context.module !== 'api' || !page) issues.push(`página não listada: ${citation.path ?? ''}`);
        else if (!literalSegments(citation.quote ?? '', [page.title, page.description, page.body, page.content]))
          issues.push(`não é trecho literal da página ${citation.path}: ${citation.quote ?? ''}`);
      } else if (!evidence.some((match) =>
        citation?.repository === match.repository && citation.path === match.path
        && citation.sha === match.sha && citation.sha === match.ref
        && Number.isInteger(citation.lineStart) && Number.isInteger(citation.lineEnd)
        && citation.lineStart > 0 && citation.lineEnd >= citation.lineStart
        && citation.lineEnd - citation.lineStart < 30
        && citation.lineStart <= match.line && match.line <= citation.lineEnd)) {
        const samePath = evidence.filter((match) => citation?.repository === match.repository && citation.path === match.path);
        const reason = samePath.length && !samePath.some((match) => citation.sha === match.sha && citation.sha === match.ref)
          ? `SHA fora do índice: ${citation?.path ?? ''}:${citation?.lineStart ?? '?'}`
          : `linha fora do índice: ${citation?.path ?? ''}:${citation?.lineStart ?? '?'}`;
        issues.push(reason);
      }
    }
  }
  return [...new Set(issues)];
}

function apiUnitIssues(units, context) {
  return units.flatMap((unit) => {
    const text = unit.text.trim();
    if (proseSegments(text).length !== 1) return [`uma frase por item: ${text.slice(0, 80)}`];
    const issues = groundingIssues({ text, grounding: [{ text, citations: unit.citations }] }, context, ['text']);
    if (!issues.length) return [];
    if (!unit.citations?.length) return issues;
    return [`citações inválidas: ${text} (${[...new Set(issues)].join('; ')})`];
  });
}

function evidenceIndex(context) {
  const provenance = (endpoint, source) => {
    if (typeof source !== 'string' || typeof endpoint.sha !== 'string') return null;
    const separator = source.lastIndexOf(':');
    const path = source.slice(0, separator);
    const line = Number(source.slice(separator + 1));
    if (separator < 1 || !Number.isSafeInteger(line) || line < 1) return null;
    return { repository: endpoint.repository ?? 'ihelpchat/olah-ihelp', path, line,
      sha: endpoint.sha, ref: endpoint.sha };
  };
  return [...context.matches ?? [], ...(context.screenFacts ?? []).map((fact) => ({
    repository: fact.repository, path: fact.source.slice(0, fact.source.lastIndexOf(':')),
    line: Number(fact.source.slice(fact.source.lastIndexOf(':') + 1)), sha: fact.sha, ref: fact.sha })),
  ...(context.callEvidence ?? []).flatMap((item) =>
    Array.from({ length: Math.max(0, item.end - item.start + 1) }, (_, offset) => ({
      repository: item.repository, path: item.path, line: item.start + offset, sha: item.sha, ref: item.ref }))),
  ...(context.endpoints ?? []).flatMap((endpoint) => [
    endpoint.source, endpoint.routeSource, endpoint.actionRouteSource, endpoint.verbSource,
    endpoint.authorizationSource, ...(endpoint.parameters ?? []).map((item) => item.source),
    ...(endpoint.responseFields ?? []).map((item) => item.source),
  ].map((source) => provenance(endpoint, source)).filter(Boolean))];
}

function groundingContext(productContext, request, existing) {
  return { ...productContext, module: request.module, request, existing };
}

function requestedApiPaths(request) {
  return new Set([request.description, request.details].filter((value) => typeof value === 'string').join('\n')
    .match(/(?<!\/)\bapi\/[a-z0-9-]+(?:\/[a-z0-9-]+)+/giu) ?? []);
}

function discardDocumentedQuestions(questions, request, productContext) {
  const paths = requestedApiPaths(request);
  if (!paths.size) return { questions, discardedQuestions: [] };
  const eligible = (productContext.endpoints ?? []).some((endpoint) => endpoint.public && endpoint.documented === false && endpoint.explicit);
  if (!eligible) return { questions, discardedQuestions: [] };
  const kept = [];
  const discardedQuestions = [];
  for (const question of questions) {
    const otherPath = question.match(/\bapi\/[a-z0-9-]+(?:\/[a-z0-9-]+)+/iu)?.[0];
    if (/documented\s*=\s*false|não documentad[oa]/iu.test(question)
      && (!otherPath || paths.has(otherPath))) discardedQuestions.push(question);
    else kept.push(question);
  }
  return { questions: kept, discardedQuestions };
}

// This classifier is shared by the API plan and other structured documentation flows.
export function classifyApiQuestions(questions, endpoints) {
  const parameters = new Set(endpoints.flatMap((endpoint) => (endpoint.parameters ?? []).map((item) => item.name.toLowerCase())));
  const fields = new Set(endpoints.flatMap((endpoint) => (endpoint.responseFields ?? [])
    .map((item) => String(item.path ?? item.name).replace(/^(?:dados\[?\]?\.)/u, '').replace(/^\[\]\./u, '')
      .split('.')[0].replace(/\[\]$/u, '').toLowerCase())));
  const blocking = [], pending = [];
  for (const question of questions) {
    const text = String(question);
    const names = [...text.matchAll(/\b(parâmetro|parametro|campo)s?\s+(?:de\s+)?[`"']?([A-Za-z_]\w*)/giu)]
      .filter((match) => !['de', 'do', 'da', 'e', 'tipo', 'tipos', 'primeiro', 'resposta'].includes(match[2].toLowerCase()));
    const asksRoute = /\b(?:rota|route|método|metodo|method|endpoint)\b/iu.test(text) && !/erros?\/status|status\s+HTTP/iu.test(text);
    const missing = names.some((match) => /parâmetro|parametro/iu.test(match[1])
      ? !parameters.has(match[2].toLowerCase()) : !fields.has(match[2].toLowerCase()));
    (asksRoute || missing ? blocking : pending).push(text);
  }
  return { blocking, pending };
}

function evidencePending(issues = []) {
  return { status: 'needs_evidence', summary: `A resposta não está vinculada às linhas do código recuperado.${issues.length ? ` ${issues.join('; ')}` : ''}`,
    questions: ['Confirme a fonte e as citações de cada afirmação.'], articles: [] };
}

function retryPrompt(issues) {
  return { role: 'developer', content: redactSensitiveData(`O validador recusou estes problemas de redação ou grounding. Corrija cada um usando apenas fontes listadas: ${issues.join('; ')}`) };
}
function apiPending(reason) {
  return { status: 'needs_information', summary: reason, questions: [reason], articles: [] };
}

function finalizeGeneratedPages(result, request, factsByPath = new Map()) {
  const securityWarnings = [];
  for (const article of result.articles) {
    const review = securityReview(article, { facts: factsByPath.get(article.path), request,
      examples: extractCitedEndpoints(article).examples });
    securityWarnings.push(...review.warnings);
    if (review.blocks.length) return finalizeSecurityResponse({ ...result, ...apiPending(`${article.path}: ${review.blocks.join('; ')}`) }, securityWarnings);
    if (review.warnings.length && !review.confirmed) return finalizeSecurityResponse({ ...result,
      ...apiPending(`Confirme a revisão de segurança de ${article.path}.`),
      questions: [`Para seguir, confirme o endpoint sensível: ${review.endpoint}`] }, securityWarnings);
  }
  return finalizeSecurityResponse(result, securityWarnings);
}
export function normalizeCatalogLabel(action) {
  return resolveCatalogAction(action) ?? action;
}

function confirmedAction(action, request, productContext) {
  if (!isCatalogAction(action)) return false;
  const inRequest = request.productRoute === action.route;
  const inCoverage = Array.isArray(productContext.coverage) && productContext.coverage.some((item) =>
    item.module?.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
      === request.module.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR')
      && Array.isArray(item.productRoutes) && item.productRoutes.includes(action.route));
  return inRequest || inCoverage;
}

const actionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'route', 'target'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    route: { type: 'string' },
    target: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'guidance', 'questions', 'risks', 'suggestedActions', 'grounding'],
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_information'] },
    guidance: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    suggestedActions: { type: 'array', items: actionSchema },
    grounding: GROUNDING_SCHEMA,
  },
};

const ARTICLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'title', 'description', 'source', 'contentType', 'body', 'productActions', 'assistantQuestion', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions', 'grounding'],
  properties: {
    path: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    source: { type: 'string', enum: ['produto', 'suporte', 'api'] },
    contentType: { type: 'string', enum: ['faq', 'tutorial', 'guia', 'referencia'] },
    body: { type: 'string' },
    productActions: { type: 'array', items: actionSchema },
    assistantQuestion: { type: 'string' },
    assistantOverview: { type: 'string' },
    assistantInitialSteps: { type: 'integer' },
    assistantSuggestions: { type: 'array', items: { type: 'string' } },
    grounding: GROUNDING_SCHEMA,
  },
};

const PACKAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'questions', 'articles', 'grounding'],
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_information'] },
    summary: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    articles: { type: 'array', items: ARTICLE_SCHEMA },
    grounding: GROUNDING_SCHEMA,
  },
};
const API_ARTICLE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['path', 'endpoint', 'title', 'description', 'intro', 'notas', 'responseDescriptions', 'parameterDescriptions'],
  properties: { path: { type: 'string' }, endpoint: { type: 'string', enum: [] }, title: { type: 'string' }, description: API_PROSE_UNIT_SCHEMA,
    intro: API_PROSE_UNIT_SCHEMA, notas: { type: 'array', items: API_PROSE_UNIT_SCHEMA },
    responseDescriptions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'description'], properties: { name: { type: 'string' }, description: API_PROSE_UNIT_SCHEMA } } },
    parameterDescriptions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['name', 'description'], properties: { name: { type: 'string' }, description: API_PROSE_UNIT_SCHEMA } } } },
};
const API_PACKAGE_SCHEMA = { ...PACKAGE_SCHEMA, required: ['status', 'summary', 'questions', 'articles'],
  properties: { status: PACKAGE_SCHEMA.properties.status,
    summary: { type: 'array', items: API_PROSE_UNIT_SCHEMA }, questions: PACKAGE_SCHEMA.properties.questions,
    articles: { type: 'array', items: API_ARTICLE_SCHEMA } } };
const FAQ_CITATION_SCHEMA = { anyOf: [CITATION_SCHEMA,
  { type: 'object', additionalProperties: false, required: ['source', 'quote'],
    properties: { source: { type: 'string', enum: ['pedido', 'suporte'] }, quote: { type: 'string' } } },
  { type: 'object', additionalProperties: false, required: ['source', 'path', 'quote'],
    properties: { source: { type: 'string', enum: ['pagina', 'negocio'] }, path: { type: 'string' }, quote: { type: 'string' } } } ] };
const FAQ_UNIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['text', 'citations'],
  properties: { text: { type: 'string' }, citations: { type: 'array', items: FAQ_CITATION_SCHEMA } } };
const FAQ_STEP_SCHEMA = { type: 'object', additionalProperties: false, required: ['acao', 'fato', 'resultado', 'observacao'],
  properties: { acao: { type: 'string', enum: ['abrir', 'clicar', 'preencher', 'selecionar', 'conferir'] },
    fato: { type: 'string' }, resultado: { type: ['string', 'null'] },
    observacao: { anyOf: [FAQ_UNIT_SCHEMA, { type: 'null' }] } } };
const FAQ_ERROR_SCHEMA = { type: 'object', additionalProperties: false, required: ['mensagem', 'corrigir'],
  properties: { mensagem: { type: 'string' }, corrigir: { anyOf: [FAQ_STEP_SCHEMA, { type: 'null' }] } } };
const FAQ_ARTICLE_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['path', 'title', 'description', 'source', 'contentType', 'sections', 'productActions', 'assistantQuestion'],
  properties: { ...Object.fromEntries(Object.entries(ARTICLE_SCHEMA.properties).filter(([key]) =>
    !['body', 'grounding', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions'].includes(key))),
    sections: { type: 'object', additionalProperties: false, required: Object.keys(FAQ_SECTIONS),
      properties: Object.fromEntries(Object.keys(FAQ_SECTIONS).map((key) => [key, { type: 'array',
        items: key === 'passos' ? FAQ_STEP_SCHEMA : key === 'erros' ? FAQ_ERROR_SCHEMA : FAQ_UNIT_SCHEMA }])) } } };
const FAQ_PACKAGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['status', 'summary', 'questions', 'articles'],
  properties: { status: PACKAGE_SCHEMA.properties.status, summary: { type: 'string' },
    questions: PACKAGE_SCHEMA.properties.questions, articles: { type: 'array', items: FAQ_ARTICLE_SCHEMA } } };
const FREE_UNIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['text'],
  properties: { text: { type: 'string' } } };
const FREE_FAQ_SCHEMA = structuredClone(FAQ_PACKAGE_SCHEMA);
FREE_FAQ_SCHEMA.properties.articles.items.properties.sections = {
  type: 'object', additionalProperties: false, required: Object.keys(FREE_FAQ_SECTIONS),
  properties: Object.fromEntries(Object.keys(FREE_FAQ_SECTIONS).map((key) => [key, key === 'passos'
    ? { type: 'array', items: { type: 'object', additionalProperties: false, required: ['tarefa', 'passos'],
      properties: { tarefa: { type: 'string' }, passos: { type: 'array', items: FREE_UNIT_SCHEMA } } } }
    : { type: 'array', items: FREE_UNIT_SCHEMA }])),
};
const FAQ_JUDGE_SCHEMA = { type: 'object', additionalProperties: false, required: ['claims'],
  properties: { claims: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['id', 'status', 'reason'], properties: { id: { type: 'string' },
      status: { type: 'string', enum: ['sustentada', 'a confirmar', 'contradiz a fonte'] },
      reason: { type: 'string' } } } } } };

function checkRequest(request) {
  const value = Object.values(request).filter((item) => typeof item === 'string').join('\n');
  if (containsSensitiveData(value)) {
    const kinds = sensitiveKinds(value);
    if (kinds.credential) throw new Error('O pedido contém possível credencial; remova antes de usar a IA editorial.');
    if (kinds.personal) throw new Error('O pedido contém possível dado pessoal; remova antes de usar a IA editorial.');
  }
  if (request.tangoUrl && !/^https:\/\/app\.tango\.us\/app\/(?:embed|workflow)\/[A-Za-z0-9-]+\/?$/.test(request.tangoUrl)) throw new Error('tangoUrl precisa ser uma URL pública oficial do Tango.');
}

function clientOf(options) {
  if (options.client) return options.client;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');
  return new OpenAI({ apiKey });
}

async function modelResponse(options, payload, productContext, publicSources = {}) {
  const client = clientOf(options);
  let response;
  if (options.client && !options.budget) response = await client.responses.create(payload);
  else {
    const result = await createBudgetedResponse(client, payload, { ...options.budget, acceptIncomplete: true });
    if (result.kind !== 'ok') throw new Error(result.kind === 'budget_exhausted' ? 'Orçamento da IA esgotado' : 'Resposta da IA indisponível');
    response = result.response;
  }
  if (response?.status === 'incomplete') return response;
  const parsed = parseModelJson(response);
  if (!parsed.ok) return response;
  const mode = payload.text.format.name === 'pacote_documentacao' ? 'package'
    : payload.text.format.name === 'guia_canonico' ? 'guide' : 'internal';
  const guarded = guardModelOutput(parsed.value, { ...productContext, ...publicSources }, mode);
  return { ...response, output_text: JSON.stringify(guarded.value) };
}

function baseRequest(name, schema, input, options) {
  return {
    model: options.model ?? process.env.OPENAI_MODEL ?? 'gpt-6-luna',
    store: false,
    reasoning: { effort: 'medium' },
    max_output_tokens: contentMaxOutputTokens(),
    text: { format: { type: 'json_schema', name, strict: true, schema } },
    input,
  };
}

function parseModelJson(response) {
  if (response?.status === 'incomplete') return { ok: false, reason: 'resposta do modelo incompleta (limite de saída)' };
  try {
    const text = String(response?.output_text ?? '').trim();
    const value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON não é objeto');
    return { ok: true, value };
  } catch {
    return { ok: false, reason: 'resposta do modelo inválida' };
  }
}

function redactPromptEvidence(text, productContext = {}) {
  const values = new Set();
  const visit = (item) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    for (const [key, value] of Object.entries(item)) {
      if (typeof value === 'string') {
        if (['sha', 'ref'].includes(key) && /^[a-f0-9]{40}$/iu.test(value)) values.add(value);
        if (key === 'repository' && /^ihelpchat\/(?:front-react|olah-ihelp)$/u.test(value)) values.add(value);
        if (key === 'path' && /^(?:src|pilot|api|docs)\/[A-Za-z0-9_./-]+$/u.test(value)
          && !value.split('/').includes('..') && !containsSensitiveData(value)) values.add(value);
        if (key === 'route' && /^\/[A-Za-z0-9_/-]{7,}$/u.test(value)) values.add(value);
      } else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(productContext);
  const protectedValues = [...values].sort((left, right) => right.length - left.length);
  let safe = String(text);
  const replacements = protectedValues.map((value, index) => {
    const marker = `__STRUCTURAL_EVIDENCE_${index}__`;
    safe = safe.replaceAll(value, marker);
    return [marker, value];
  });
  safe = redactSensitiveData(safe);
  for (const [marker, value] of replacements) safe = safe.replaceAll(marker, value);
  return safe;
}

function requestText(request, existing, productContext, codeHygiene = {}) {
  const explicit = explicitEndpointsFrom(request).length > 0;
  const selectedEndpoints = (productContext.endpoints ?? []).filter((item) => explicit ? item.explicit : item.documented);
  codeHygiene.literalsOmitted = 0;
  codeHygiene.commentsRemoved = 0;
  const safeCode = (excerpt) => {
    const result = sanitizeCodeForModel(excerpt);
    codeHygiene.literalsOmitted += result.literalsOmitted;
    codeHygiene.commentsRemoved += result.commentsRemoved;
    return result.text;
  };
  const numberedCode = (sanitized, firstLine) => {
    const lines = sanitized.split('\n');
    const originalFirst = lines[0]?.match(/^(\d+):\s?/u);
    const start = originalFirst ? Number(originalFirst[1]) : firstLine;
    return lines.map((line, offset) => `${start + offset}| ${line.replace(/^\d+:\s?/u, '')}`).join('\n');
  };
  return [
    `Tema: ${request.topic}`,
    `Módulo: ${request.module}`,
    `<<PEDIDO>>\n${request.description}${request.details ? `\n${request.details}` : ''}\n<<FIM DO PEDIDO>>`,
    `Público: ${request.audience ?? 'Cliente em trial sem treinamento'}`,
    request.productRoute ? `Rota confirmada no produto: ${request.productRoute}` : '',
    request.tangoUrl ? `Tango já existente: ${request.tangoUrl}` : '',
    `Documentação publicada semelhante (fonte editorial):\n${existing.length ? existing.map((item) => `- ${item.title} (${item.path}): ${item.description}${item.body ? `\n${item.body}` : ''}`).join('\n') : '- Nenhum'}`,
    `Contexto dos codebases:\n${productContext.matches.length ? productContext.matches.map((item) => `REPOSITÓRIO ${item.repository}@${item.ref} (${item.role})\nARQUIVO ${redactSensitiveData(item.path)} LINHA ${item.line ?? 'não informada'} SHA ${item.sha ?? item.ref}\n${numberedCode(safeCode(item.excerpt), item.line)}`).join('\n\n') : '- Indisponível ou sem correspondências'}`,
    productContext.screenFacts?.length ? `FATOS DA TELA (texto visível, sem código; cite arquivo:linha e SHA):\n${JSON.stringify(productContext.screenFacts)}` : '',
    request.module === 'api' && productContext.callEvidence?.length ? `TRECHOS INTERNOS ALCANÇADOS (cite arquivo:linha; não publique código):\n${productContext.callEvidence.map((item) => `${item.path}:${item.start}-${item.end}\n${numberedCode(safeCode(item.excerpt), item.start)}`).join('\n\n')}` : '',
    request.module === 'api' ? `FATOS ESTRUTURADOS DE ENDPOINTS (somente public=true é gerável):\n${JSON.stringify(selectedEndpoints)}\nFORMATO REAL DAS PÁGINAS API:\n${JSON.stringify(productContext.apiExamples ?? [])}\nMODELOS DE ESTILO (não são fatos do endpoint pedido):\n${JSON.stringify(productContext.apiStyleExamples ?? [])}` : '',
    faqRequested(request) ? `FATOS DA TELA (use os rótulos exatos em negrito nos passos):\n${JSON.stringify(adaptScreenFacts({ facts: productContext.screenFacts ?? [], sha: productContext.code?.find((item) => item.role === 'frontend')?.ref }, productContext.coverage))}\nCONTEXTO DE NEGÓCIO 🟢 CURADO DO MÓDULO:\n${JSON.stringify(productContext.businessContext ?? [])}\nMODELOS DE ESTILO FAQ (não são fatos do tema):\n${JSON.stringify(productContext.faqStyleExamples ?? [])}` : '',
    `Sinais agregados do suporte:\n${productContext.support?.categories?.length ? productContext.support.categories.map((item) => `- ${item.category}: ${item.guidance}`).join('\n') : '- Nenhum sinal específico'}`,
    `Regras do suporte:\n${productContext.support?.rules?.map((item) => `- ${item}`).join('\n') ?? '- Nenhuma'}`,
    `Matriz de cobertura:\n${productContext.coverage?.map((item) => `- ${item.module}: ${item.coverage}; rotas=${item.productRoutes.join(', ')}; permissão=${item.permission}`).join('\n') ?? '- Nenhuma correspondência'}`,
    `Catálogo confiável de ProductAction (id, label, route, target):\n${catalogActions().map((action) => JSON.stringify(action)).join('\n')}`,
  ].filter(Boolean).map((part) => redactPromptEvidence(part, productContext)).join('\n');
}

function pageMatchesEndpoint(page, endpoint) {
  return page?.frontmatter?.method && page?.frontmatter?.endpoint && endpoint.verb === page.frontmatter.method && [endpoint.route, ...(endpoint.optionalAliases ?? (endpoint.optionalAlias ? [endpoint.optionalAlias] : []))]
    .some((route) => route.replace(/^\/api\/v\d+/iu, '').toLowerCase().replace(/\{[^}]+\}/gu, '{}')
      === page.frontmatter.endpoint.toLowerCase().replace(/\{[^}]+\}/gu, '{}'));
}

function publicEndpointId(endpoint) {
  return `${endpoint.verb} ${endpoint.route.replace(/^\/api\/v\d+/iu, '')}`;
}

async function generateApiPages(options, payload, productContext, selectable) {
  const articles = [];
  const pending = [];
  let summary;
  let model;
  const state = options.apiCallState;
  for (const endpoint of selectable) {
    const id = publicEndpointId(endpoint);
    if (state.cache.has(id) && !options.apiRetryEndpoints?.has(id)
      && !(selectable.length === 1 && options.retryIssues)) {
      articles.push(state.cache.get(id));
      continue;
    }
    const schema = structuredClone(payload.text.format.schema);
    schema.properties.articles.items.properties.endpoint.enum = [id];
    schema.properties.articles.items.properties.responseDescriptions.items.properties.name = {
      type: 'string', enum: (endpoint.responseFields ?? []).map((field) => responseFieldPath(endpoint, field)),
    };
    schema.properties.articles.items.properties.parameterDescriptions.items.properties.name = {
      type: 'string', enum: endpoint.parameters.map((item) => item.name),
    };
    const input = structuredClone(payload.input);
    input[0].content += ' Gere exatamente um artigo para o endpoint indicado nos fatos desta chamada. Não inclua páginas irmãs.';
    input[1].content = input[1].content.replace(
      /FATOS ESTRUTURADOS DE ENDPOINTS \(somente public=true é gerável\):\n[^\n]+/u,
      `FATOS ESTRUTURADOS DE ENDPOINTS (somente public=true é gerável):\n${JSON.stringify([endpoint])}`);
    input[1].content += `\nREFS POSSÍVEIS PARA PÁGINAS IRMÃS (somente referência, não gerar):\n${JSON.stringify(selectable.filter((item) => item !== endpoint)
      .map((item) => ({ endpoint: publicEndpointId(item), route: item.route,
        names: [...(item.parameters ?? []).map((field) => field.name), ...(item.responseFields ?? []).map((field) => field.name)] })))}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (state.used >= state.limit || (state.perPage.get(id) ?? 0) >= 2) {
        pending.push(`${id}: teto global de chamadas atingido`);
        break;
      }
      state.used++;
      state.perPage.set(id, (state.perPage.get(id) ?? 0) + 1);
      const response = await modelResponse(options, { ...payload, text: { ...payload.text,
        format: { ...payload.text.format, schema } }, input }, productContext);
      model = response.model;
      const parsed = parseModelJson(response);
      if (!parsed.ok) {
        if (attempt === 1) pending.push(`${id}: ${parsed.reason}`);
        continue;
      }
      // Older test providers return a package despite the single-page schema.
      if (options.client && !options.budget && parsed.value.articles?.length > 1)
        return { parsed: parsed.value, pending, model };
      if (parsed.value.status !== 'ready' || (selectable.length === 1 && parsed.value.articles?.[0]?.endpoint !== id))
        return { parsed: parsed.value, pending, model };
      if (parsed.value.status !== 'ready' || !Array.isArray(parsed.value.articles)
        || parsed.value.articles.length !== 1 || parsed.value.articles[0]?.endpoint !== id) {
        if (attempt === 1) pending.push(`${id}: resposta de página inválida`);
        continue;
      }
      articles.push(parsed.value.articles[0]);
      state.cache.set(id, parsed.value.articles[0]);
      summary ??= parsed.value.summary;
      break;
    }
  }
  return { parsed: { status: articles.length ? 'ready' : 'needs_information',
    summary: selectable.length === 1 ? summary ?? articles.map((article) => article.description)
      : articles.map((article) => article.description), questions: [], articles }, pending, model };
}

function groundingPending(context) {
  const missingCitation = context.pending?.filter((item) => item.startsWith('endpoint citado não encontrado')) ?? [];
  if (missingCitation.length) return { status: 'needs_information', summary: missingCitation.join('; '),
    questions: missingCitation, articles: [], pending: context.pending };
  if (!context.groundingRequired || (context.code.length && context.code.every(({ available }) => available) && (context.matches.length || context.callEvidence?.length || context.screenFacts?.length))) return null;
  return {
    status: 'needs_information',
    summary: 'Código do produto indisponível ou sem evidência para este tema.',
    guidance: 'Código do produto indisponível ou sem evidência para este tema.',
    questions: ['Confirme os checkouts autorizados, seus SHAs e a implementação do tema.'],
    risks: [], suggestedActions: [], articles: [],
    pending: [context.code?.some(({ available }) => !available) || !context.code?.length
      ? 'código do produto indisponível' : 'nenhum trecho encontrado no código do produto'],
  };
}

export function explicitEndpointsFrom(request) {
  const text = [request.description, request.details].filter((value) => typeof value === 'string').join('\n');
  return [...text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/(?:[A-Za-z0-9_{}:?-]+\/)*[A-Za-z0-9_{}:?-]+)/giu)]
    .map((match) => ({ verb: match[1].toUpperCase(), route: match[2].replace(/\{([A-Za-z][A-Za-z0-9_]*)(?::[^{}]+)?\??\}/gu, '{$1}').replace(/\/+$/u, '') }));
}

async function related(root, request) {
  const queries = [request.topic, `${request.module} ${request.topic}`];
  const found = [];
  for (const query of queries) {
    try {
      for (const item of await searchContent(root, query, 5)) if (!found.some(({ path }) => path === item.path)) found.push(item);
    } catch {}
  }
  return Promise.all(found.slice(0, 4).map(async (item) => {
    const path = item.path.replace(/^\//, '');
    const article = await readArticle(root, path).catch(() => null);
    return { ...item, title: redactSensitiveData(item.title), description: redactSensitiveData(item.description), ...(article ? { body: redactSensitiveData(article.body.slice(0, 4_000)) } : {}) };
  }));
}

async function planContentCore(root, request, options = {}) {
  checkRequest(request);
  const existing = await related(root, request);
  const productContext = options.productContext ?? await getIhelpContext(root, request.topic, request.module, { ...options.contextOptions, requireLocal: true, ...(request.module === 'api' ? { repositoryIds: ['backend'] } : {}), explicitEndpoints: explicitEndpointsFrom(request) }).catch(() => ({ groundingRequired: true, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] }));
  if (faqRequested(request)) {
    productContext.businessContext ??= await loadBusinessContext(root, request.module);
    productContext.faqStyleExamples ??= await selectFaqStyleExamples(`${root}/content/docs/docs`);
  }
  if (productContext.pending?.some((item) => item.startsWith('endpoint citado não encontrado'))) return groundingPending(productContext);
  if (request.module === 'api' && !productContext.endpoints?.length) return apiPending(productContext.nonPublicEndpoints ? 'endpoint não público: confirmar' : 'endpoints estruturados ausentes');
  if (request.module === 'api' && !productContext.endpoints.some((item) => item.public)) return apiPending('endpoint não público: confirmar');
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const codeHygiene = {};
  const response = await modelResponse(options, baseRequest('plano_documentacao', request.module === 'api'
    ? { ...PLAN_SCHEMA, properties: { ...PLAN_SCHEMA.properties, grounding: API_GROUNDING_SCHEMA } } : PLAN_SCHEMA, [
    {
      role: 'developer',
      content: [
        'Você é a editora de conteúdo do iHelp. Oriente quem está criando documentação antes de escrever.',
        'O público final acabou de acessar o produto há 30 segundos, está em trial e não recebeu treinamento.',
        'Identifique conflitos, informação ausente, duplicidade e nomes de telas ou botões que precisam ser confirmados.',
        'Não pergunte o que os FATOS DA TELA já respondem; cite o fato.',
        request.module === 'api' ? 'Use needs_information somente quando faltar método, rota, parâmetro ou campo de primeiro nível da resposta. Outras dúvidas são pendências não bloqueantes. Não invente comportamento.' : faqRequested(request) ? 'O núcleo do FAQ é a resposta direta e um passo para CADA tarefa pedida com fatos de tela. Se uma tarefa não tiver fatos, registre pendência; não bloqueie as demais. Use needs_information só quando NENHUMA tarefa pedida tiver fatos de tela. Não invente comportamento.' : 'Use status=needs_information quando faltar qualquer fato necessário; faça perguntas curtas e específicas. Não invente comportamento do produto.',
        'Sugira ações no produto somente com rota fornecida ou sustentada pelos detalhes. target é um identificador data-help-id estável, nunca um seletor CSS.',
        request.module === 'api' ? 'Planeje páginas de referência da API. Para tema amplo, foque nos endpoints documented=true. Se o pedido nomeia o caminho de uma página nova para um endpoint público, documented=false não exige pergunta. Não peça dados já presentes nos fatos estruturados. Endpoint sem public=true exige confirmação. responseFields=null não bloqueia: a resposta exibirá nota fixa e pendência.' : faqRequested(request) ? 'Planeje uma página FAQ completa. Só planeje um tutorial separado se o pedido solicitar explicitamente mais de um tipo de artigo.' : 'O pacote final deve incluir uma FAQ curta, um tutorial completo, passos guiados no produto e navegação. Vídeo não faz parte do escopo.',
        request.module === 'api' ? 'Guidance e risks são orientação interna e não precisam de grounding por frase. Nunca são publicados. Podem mencionar métodos e nomes técnicos para orientar a geração; o schema é a única validação desta resposta. A prosa publicada será validada com grounding completo na geração.' : faqRequested(request) ? 'Guidance e risks são orientação interna e não precisam de grounding por frase. A prosa publicada terá citações em cada unidade.' : 'No modo com código, cada frase ou passo de guidance e risks precisa de um item grounding com texto idêntico e citações estruturadas do contexto: repository, path, lineStart, lineEnd, sha. Sem evidência para o núcleo, use needs_information.',
      ].join(' '),
    },
    { role: 'user', content: requestText(request, existing, productContext, codeHygiene) },
    ...(options.groundingRetryIssues ? [retryPrompt(options.groundingRetryIssues)] : []),
  ], options), productContext, { request, existing });
  const modelJson = parseModelJson(response);
  if (!modelJson.ok) return { ...apiPending(modelJson.reason), pending: productContext.pending ?? [] };
  const parsed = modelJson.value;
  const filtered = request.module === 'api' ? discardDocumentedQuestions(parsed.questions ?? [], request, productContext)
    : { questions: parsed.questions ?? [], discardedQuestions: [] };
  parsed.questions = filtered.questions;
  const classified = request.module === 'api' ? classifyApiQuestions(parsed.questions, productContext.endpoints ?? [])
    : faqRequested(request) ? classifyFaqQuestions(parsed.questions, request, productContext.screenFacts ?? [])
      : { blocking: parsed.questions, pending: [] };
  if (request.module === 'api' || faqRequested(request)) parsed.questions = classified.blocking;
  if ((request.module === 'api' || faqRequested(request)) && parsed.status === 'needs_information' && !parsed.questions.length) parsed.status = 'ready';
  else if ((request.module === 'api' || faqRequested(request)) && classified.blocking.length) parsed.status = 'needs_information';
  if (faqRequested(request) && !hasFaqTaskFacts(productContext.screenFacts)) {
    parsed.status = 'needs_information';
    if (!parsed.questions.length) parsed.questions = ['Faltam fatos da tela para as tarefas pedidas.'];
  }
  if (parsed.status === 'ready') {
    const issues = request.module === 'api' || faqRequested(request) ? []
      : groundingIssues(parsed, groundingContext(productContext, request, existing), ['guidance', 'risks']);
    if (issues.length) {
      if (!options.groundingRetryIssues) return planContent(root, request, { ...options, productContext, groundingRetryIssues: issues });
      return { ...evidencePending(issues), pending: productContext.pending ?? [] };
    }
  }
  const { grounding: _grounding, ...safePlan } = parsed;
  return { ...safePlan, discardedQuestions: filtered.discardedQuestions, suggestedActions: parsed.suggestedActions.map(normalizeCatalogLabel), existing, pending: [...new Set([...(productContext.pending ?? []), ...classified.pending.map((question) => `pergunta pendente: ${question}`)])], codeHygiene, productContext: { repositories: productContext.code?.map(({ repository, ref, role }) => ({ repository, ref, role })) ?? [], files: productContext.matches.map(({ repository, path, line, sha }) => `${repository}:${redactSensitiveData(path)}:${line ?? '?'}@${sha ?? '?'}`), supportCategories: productContext.support?.categories?.map(({ category }) => category) ?? [] }, model: response.model };
}

async function generateContentPackageCore(root, request, options = {}) {
  checkRequest(request);
  const screenCaptureManifest = options.screenCaptureManifest ?? await loadScreenshotManifest(root);
  const existing = await related(root, request);
  const productContext = options.productContext ?? await getIhelpContext(root, request.topic, request.module, { ...options.contextOptions, requireLocal: true, ...(request.module === 'api' ? { repositoryIds: ['backend'] } : {}), explicitEndpoints: explicitEndpointsFrom(request) }).catch(() => ({ groundingRequired: true, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] }));
  if (faqRequested(request)) {
    productContext.businessContext ??= await loadBusinessContext(root, request.module);
    productContext.faqStyleExamples ??= await selectFaqStyleExamples(`${root}/content/docs/docs`);
  }
  let plan = options.plan;
  const withPending = (result) => ({ securityWarnings: [], ...result, pending: [...new Set([...(productContext.pending ?? []), ...(plan?.pending ?? []), ...(options.faqCarryPending ?? []), ...(result.pending ?? [])])] });
  if (productContext.pending?.some((item) => item.startsWith('endpoint citado não encontrado'))) return groundingPending(productContext);
  if (request.module === 'api' && !productContext.endpoints?.length) return withPending(apiPending(productContext.nonPublicEndpoints ? 'endpoint não público: confirmar' : 'endpoints estruturados ausentes'));
  if (request.module === 'api' && !productContext.endpoints.some((item) => item.public)) return withPending(apiPending('endpoint não público: confirmar'));
  const pending = groundingPending(productContext);
  if (pending) return pending;
  plan ??= await planContent(root, request, { ...options, productContext });
  if (plan.status !== 'ready') {
    return withPending({ status: plan.status, summary: plan.summary ?? plan.guidance, questions: plan.questions,
      discardedQuestions: plan.discardedQuestions ?? [], articles: [], existing, model: plan.model });
  }
  const { pending: _pending, discardedQuestions: _discardedQuestions, ...planForPrompt } = plan;
  const explicit = request.module === 'api' && explicitEndpointsFrom(request).length > 0;
  const selectable = request.module === 'api' ? productContext.endpoints.filter((item) => item.public && (explicit ? item.explicit : item.documented)) : [];
  if (request.module === 'api' && !selectable.length) return withPending(apiPending('endpoint não público: confirmar'));
  const apiCallState = options.apiCallState ?? { used: 0, limit: 2 * selectable.length + 2, perPage: new Map(), cache: new Map() };
  options = { ...options, apiCallState };
  const fieldPaths = [...new Set(selectable.flatMap((endpoint) =>
    (endpoint.responseFields ?? []).map((field) => responseFieldPath(endpoint, field))))];
  const parameterNames = [...new Set(selectable.flatMap((endpoint) => endpoint.parameters.map((item) => item.name)))];
  const responseDescriptions = structuredClone(API_ARTICLE_SCHEMA.properties.responseDescriptions);
  responseDescriptions.items.properties.name = fieldPaths.length ? { type: 'string', enum: fieldPaths } : { type: 'string' };
  const parameterDescriptions = structuredClone(API_ARTICLE_SCHEMA.properties.parameterDescriptions);
  parameterDescriptions.items.properties.name = parameterNames.length ? { type: 'string', enum: parameterNames } : { type: 'string' };
  const apiSchema = { ...API_PACKAGE_SCHEMA, properties: { ...API_PACKAGE_SCHEMA.properties,
    articles: { type: 'array', items: { ...API_ARTICLE_SCHEMA, properties: { ...API_ARTICLE_SCHEMA.properties,
      endpoint: { type: 'string', enum: selectable.map(publicEndpointId) }, responseDescriptions, parameterDescriptions } } } } };
  const payload = baseRequest('pacote_documentacao', request.module === 'api' ? apiSchema : faqRequested(request) ? FREE_FAQ_SCHEMA : PACKAGE_SCHEMA, [
    {
      role: 'developer',
      content: [
        request.module === 'api' || !faqRequested(request) ? 'Crie um pacote completo de documentação do iHelp usando apenas os fatos fornecidos.'
          : 'Escreva o FAQ com os fatos da tela e a experiência do cliente. Afirmações sem fonte serão marcadas pelo juiz para revisão.',
        request.module === 'api' ? 'O público da referência conhece HTTP. Descreva somente o contrato sustentado pelos fatos.' : 'O público acabou de acessar o iHelp há 30 segundos, está em trial e não recebeu treinamento. Nunca suponha que conhece menus, termos ou pré-requisitos.',
        request.module === 'api' ? 'Escreva path, endpoint, title, description, intro e notas para endpoints públicos. Escolha endpoint exatamente da lista fechada do schema, um endpoint distinto por artigo. A ordem dos artigos deve seguir a ordem dos fatos. Use os modelos somente como estilo: explique o que o endpoint faz, quando usar, o que retorna, erros comuns e notas úteis, incluindo de onde vem cada id quando houver fonte. Não copie fatos dos modelos para outro endpoint. Não escreva método, rota, parâmetros, resposta, componentes, frontmatter ou código. Se o endpoint não for público, responda needs_information com "endpoint não público: confirmar".' : faqRequested(request) ? 'Gere UMA página FAQ em docs/. Escreva livremente como atendente experiente para cliente 60+, com frases naturais e curtas. Em sections inclua O que é em 2–3 frases, Para que serve com ganho, Casos de uso em tópicos (situação → ação → resultado), Passo a passo por tarefa (Buscar, Cadastrar, Editar, Responsável, Importar, Agendar conforme o pedido e fatos), Dúvidas comuns, Erros comuns e o que fazer. Cada passo é texto livre, com rótulos exatos da tela em negrito. Deixe suporte vazio; o sistema adiciona a seção fixa. Use modelos só para estilo, nunca como fatos. Se faltar contexto de negócio, ainda escreva as seções de negócio: o juiz marcará a confirmar.' : 'Gere exatamente dois artigos quando o tema for operacional: uma FAQ em docs/ e um tutorial em tutoriais/. Ambos devem começar dizendo onde a pessoa está e onde deve clicar.',
        request.module === 'api' ? 'A parte técnica será renderizada dos fatos depois da sua resposta. summary é uma lista de objetos {text,citations,refs}, com uma frase por item; description, intro, cada nota e cada descrição de responseDescriptions e parameterDescriptions são objetos {text,citations,refs}, também com uma frase por text (ponto e vírgula permitido). Use refs: [] quando não houver referência cruzada. Não crie grounding separado no pacote. Em responseDescriptions, use em name o caminho completo de um campo de resposta do enum, incluindo envelope e [] quando houver. Em parameterDescriptions, use em name o nome exato de um parâmetro do enum e explique-o individualmente, com nome técnico entre crases no texto se for citado. Cite cada descrição. Sem fonte, omita o item da lista. Reserve notas para comportamentos que atravessam parâmetros, como cabeçalhos e diferenças entre endpoints.' : faqRequested(request) ? 'Em passos use objetos {tarefa,passos:[{text}]}, com um ### por tarefa. Escreva instruções completas, na ordem da tela, sem repetir abertura do mesmo menu. Tarefa pedida sem fatos da tela não vira seção; registre-a como pendência para a PR. Em Casos de uso use 2 ou 3 itens {text}, cada um com situação, ação e resultado. Não gere print se não houver manifesto. Nenhuma estrutura acao/fato da versão antiga.' : 'Cada passo deve conter uma ação, o resultado visível e, quando necessário, como confirmar que funcionou. Não repita a mesma instrução em introdução, listas e passos.',
        request.module === 'api' ? '' : 'productActions liga o artigo ao produto. Use somente rotas confirmadas no pedido ou na cobertura do módulo; o plano da IA não confirma ações sozinho. Nunca gere vídeo, VideoEmbed, iframe, credencial, dado pessoal ou link legado.',
        request.module === 'api' ? '' : 'Use somente ProductAction do catálogo confiável no contexto, com id, label, route e target exatos. Não invente ação, rota nem target.',
        request.module === 'api' ? 'Não inclua campos assistant nem campos técnicos nas páginas de referência.' : faqRequested(request) ? 'Preencha assistantQuestion com uma pergunta canônica. Os demais campos do assistente vêm da resposta direta e dos passos validados.' : 'Em cada artigo preencha assistantQuestion com uma pergunta canônica, assistantOverview com orientação curta e útil a iniciante, assistantInitialSteps com 1 a 3 passos concretos presentes no body e assistantSuggestions com 1 a 3 próximas perguntas ou ações distintas. Não duplique passos.',
        request.module === 'api' ? 'Se faltar método, rota, parâmetros ou autorização, use needs_information e deixe articles vazio. responseFields=null é permitido: a resposta terá nota fixa e pendência.' : faqRequested(request) ? 'Use needs_information só quando não houver fatos para o passo principal. Afirmações de negócio sem fonte podem ser escritas: o juiz as marcará a confirmar. Verbo destrutivo só pode aparecer dentro de rótulo exato da tela em negrito, nunca em texto livre.' : 'Se houver conflito entre fontes ou faltar nome de botão, formato aceito, permissão ou resultado esperado, use status=needs_information, liste as perguntas e deixe articles vazio.',
        request.module === 'api' ? 'A prosa não pode conter método HTTP, caminho, bloco de código, componente JSX nem código inline, exceto nome exato de parâmetro ou campo dos fatos. Nome técnico de outro endpoint do pacote exige refs: [{name,endpoint}] na própria unidade, com endpoint exato do enum; o nome deve ser parâmetro, campo ou segmento da rota desse endpoint. O link para a página referenciada é renderizado automaticamente. O summary mantém escopo global. Descreva cada campo pelo significado e pelo tipo PÚBLICO (texto, número, data e hora, verdadeiro ou falso, lista, objeto), nunca pelo tipo do código, DTO, entity, repository ou service.' : faqRequested(request) ? 'Cada seção é lista de objetos {text}; passos é lista de tarefas. O juiz semântico avaliará cada frase com pedido, fatos da tela, contexto de negócio, sinais de suporte, páginas publicadas e manifesto de prints. Escreva como pessoa do suporte, sem jargão inexplicado, sem dados reais, sem código interno. Na página nunca fale das fontes, do pedido nem do material; dúvidas sobre confirmação, suposições e lacunas vão somente para pendencias da PR. Explique a ação diretamente. Tire espaços de dentro das bordas de **rótulos em negrito**. Não apague uma seção útil só por falta de fonte.' : 'Cada body precisa ter pelo menos 60 palavras, Markdown simples e linguagem concreta. FAQ responde rapidamente; tutorial ensina do início ao resultado final.',
        request.module === 'api' ? 'Cite cada unidade de summary, description, intro, notas e descrições de campo nas citations da própria unidade. source: "pedido" só pode citar trecho literal dentro de <<PEDIDO>>...<<FIM DO PEDIDO>>; source: "pagina" só pode citar trecho literal de página publicada listada no contexto, com path e quote. Cada quote deve ter pelo menos 12 caracteres. Para fatos técnicos, cite o código com repository, path, lineStart, lineEnd e sha. Use os números reais mostrados ao lado do código e cite a faixa mais curta que contém o comportamento, com no máximo 30 linhas. O JSON interno de formato não é fonte. O pedido não confirma nomes de parâmetros nem campos; estes precisam existir nos fatos do código.' : faqRequested(request) ? 'Rótulos em negrito precisam corresponder exatamente a fatos da tela. Não ponha em negrito o nome de um botão citado por uma página publicada se ele não estiver nos FATOS DA TELA; deixe a frase em texto comum para avaliação do juiz. Título de guia publicado pode ser link, sem negrito. Ação destrutiva precisa de fato de ação com o mesmo verbo. O juiz classifica sustentada, a confirmar ou contradiz a fonte. O time resolve pendências na prévia.' : 'No modo com código, cada frase ou passo de summary e de description, body, assistantOverview e assistantSuggestions em cada artigo precisa de item grounding com texto idêntico e citações estruturadas: repository, path, lineStart, lineEnd, sha. Sem evidência, use needs_information.',
      ].filter(Boolean).join(' '),
    },
    { role: 'user', content: redactPromptEvidence(`${requestText(request, existing, productContext)}\n\nPlano aprovado:\n${JSON.stringify(planForPrompt)}`, productContext) },
    ...(options.retryIssues ? [retryPrompt(options.retryIssues)] : []),
    ...(options.faqRetryIssues ? [retryPrompt(options.faqRetryIssues)] : []),
  ], options);
  const apiPages = request.module === 'api' ? await generateApiPages(options, payload, productContext, selectable) : null;
  const response = apiPages ? { model: apiPages.model, output_text: JSON.stringify(apiPages.parsed) }
    : await modelResponse(options, payload, productContext, { request, existing });
  const modelJson = parseModelJson(response);
  if (!modelJson.ok) return withPending(apiPending(modelJson.reason));
  const parsed = modelJson.value;
  if (faqRequested(request) && Array.isArray(parsed.articles)) for (const article of parsed.articles)
    if (typeof article.path === 'string' && /^\/docs\//u.test(article.path)) article.path = article.path.slice(1);
  const { grounding: _grounding, ...safePackage } = parsed;
  const faqCoreTasks = faqRequested(request) && hasFaqTaskFacts(productContext.screenFacts)
    ? missingFaqTaskSteps(request, adaptScreenFacts({ facts: productContext.screenFacts,
      sha: productContext.code?.find((item) => item.role === 'frontend')?.ref }, productContext.coverage), [])
      .map((item) => item.replace(/^tarefa sem passo: /u, '')) : [];
  const faqCoreInstruction = `Escreva os passos das tarefas que têm FATOS DA TELA: ${faqCoreTasks.join(', ')}. As outras tarefas ficam em pendência. Não recuse a página inteira.`;
  const refusedFaq = () => withPending({ status: 'needs_information',
    summary: 'modelo recusou com fatos disponíveis',
    questions: [...new Set([...(parsed.questions ?? []), 'modelo recusou com fatos disponíveis'])],
    pending: ['modelo recusou com fatos disponíveis'], articles: [], existing, model: response.model });
  if (request.module === 'api' && Array.isArray(parsed.summary))
    safePackage.summary = parsed.summary.map((unit) => typeof unit?.text === 'string' ? unit.text.trim() : '').join(' ');
  if (parsed.status !== 'ready') {
    if (faqCoreTasks.length && !options.faqRetryIssues) {
      return generateContentPackage(root, request, { ...options, productContext, plan,
        faqRetryIssues: [faqCoreInstruction, ...(parsed.questions ?? [])],
        faqCarryPending: [...(options.faqCarryPending ?? []), ...(parsed.questions ?? []).map((question) => `pergunta pendente: ${question}`)] });
    }
    if (faqRequested(request) && faqCoreTasks.length) return refusedFaq();
    return withPending({ ...safePackage, articles: [], existing, model: response.model });
  }
  if (request.module === 'api') {
    if (!Array.isArray(parsed.summary) || !parsed.summary.length
      || !parsed.summary.every((unit) => unit && typeof unit === 'object' && !Array.isArray(unit)
        && typeof unit.text === 'string' && Array.isArray(unit.citations))) {
      return withPending(apiPending('schema de summary inválido'));
    }
  }
  if (!Array.isArray(parsed.articles)) return withPending(apiPending('schema de artigos inválido'));
  if (faqRequested(request) && !faqMultipleTypesRequested(request)) {
    const faq = parsed.articles.find((article) => article.contentType === 'faq' && /^docs\//u.test(article.path ?? ''));
    if (faq) {
      if (!faq.sections?.passos?.length) {
        const tutorial = parsed.articles.find((article) => article.contentType === 'tutorial');
        if (tutorial?.sections?.passos?.length) faq.sections.passos = tutorial.sections.passos;
      }
      parsed.articles = [faq];
      safePackage.articles = parsed.articles;
    }
  }
  if (faqCoreTasks.length && !parsed.articles.some((article) => article.sections?.passos?.length)) {
    if (options.faqRetryIssues) return refusedFaq();
    return generateContentPackage(root, request, { ...options, productContext, plan,
      faqRetryIssues: [faqCoreInstruction] });
  }
  if (request.module === 'api' && !parsed.articles.length) return withPending(apiPending('nenhuma página de API gerada'));
  if (request.module === 'api') {
    if (!productContext.apiExamples?.length) return withPending(apiPending('formato da referência API indisponível'));
    const context = groundingContext(productContext, request, existing);
    const proseProblems = [];
    const groundingProblems = [];
    const missingParameterDescriptions = [];
    const apiRetryEndpoints = new Set();
    for (const prose of parsed.articles) {
      const endpoint = selectable.find((item) => publicEndpointId(item) === prose.endpoint);
      if (!endpoint || apiSchemaIssue(prose)) continue;
      const before = proseProblems.length + groundingProblems.length + missingParameterDescriptions.length;
      const units = [prose.description, prose.intro, ...prose.notas];
      proseProblems.push(...proseIssues({ title: prose.title, description: '', intro: '', notas: [] }, endpoint, selectable));
      for (const unit of units) {
        proseProblems.push(...referenceIssues(unit, selectable, parsed.articles));
        proseProblems.push(...proseIssues({ title: '', description: unit.text, intro: '', notas: [] }, endpoint, selectable, unit.refs));
      }
      groundingProblems.push(...apiUnitIssues(units, context));
      for (const item of prose.responseDescriptions ?? []) {
        proseProblems.push(...referenceIssues(item.description, selectable, parsed.articles));
        proseProblems.push(...proseIssues({ title: '', description: item.description.text, intro: '', notas: [] }, endpoint, selectable, item.description.refs));
        groundingProblems.push(...apiUnitIssues([item.description], context));
      }
      for (const item of prose.parameterDescriptions ?? []) {
        proseProblems.push(...referenceIssues(item.description, selectable, parsed.articles));
        proseProblems.push(...proseIssues({ title: '', description: item.description.text, intro: '', notas: [] }, endpoint, selectable, item.description.refs));
        groundingProblems.push(...apiUnitIssues([item.description], context));
      }
      for (const parameter of endpoint.parameters.filter((item) => item.in !== 'route' || item.required !== false)) {
        if (!prose.parameterDescriptions?.some((item) => item.name === parameter.name))
          missingParameterDescriptions.push('parâmetro sem descrição: ' + parameter.name);
      }
      if (proseProblems.length + groundingProblems.length + missingParameterDescriptions.length > before)
        apiRetryEndpoints.add(prose.endpoint);
    }
    proseProblems.push(...proseIssues({ title: safePackage.summary, description: '', intro: '', notas: [] },
      { parameters: [], responseFields: selectable.flatMap((item) => item.responseFields ?? []) }, selectable, [], true));
    for (const [index, unit] of parsed.summary.entries()) {
      const before = proseProblems.length + groundingProblems.length;
      proseProblems.push(...referenceIssues(unit, selectable, parsed.articles));
      groundingProblems.push(...apiUnitIssues([unit], context));
      if (proseProblems.length + groundingProblems.length > before)
        apiRetryEndpoints.add(parsed.articles[Math.min(index, parsed.articles.length - 1)]?.endpoint);
    }
    const retryIssues = [...new Set([...proseProblems, ...groundingProblems,
      ...(!options.retryIssues ? missingParameterDescriptions : [])])];
    if (retryIssues.length) {
      if (!options.retryIssues) return generateContentPackage(root, request, { ...options, productContext, plan,
        retryIssues, apiRetryEndpoints });
      return withPending(proseProblems.length ? apiPending(retryIssues.join('; ')) : evidencePending(retryIssues));
    }
    const articles = [];
    const usedEndpoints = new Set();
    const pending = [];
    pending.push(...missingParameterDescriptions);
    const factsByPath = new Map();
    const requestedSection = [request.description, request.details].filter((value) => typeof value === 'string').join(' ').match(/(?<!\/)\bapi\/([a-z0-9-]+)\//iu)?.[1];
    for (const prose of parsed.articles) {
      const schemaIssue = apiSchemaIssue(prose);
      if (schemaIssue) return withPending(apiPending(schemaIssue));
      if (!apiSchema.properties.articles.items.properties.endpoint.enum.includes(prose.endpoint))
        return withPending(apiPending(`endpoint fora da lista: ${prose.endpoint}`));
      if (usedEndpoints.has(prose.endpoint)) return withPending(apiPending(`endpoint repetido: ${prose.endpoint}`));
      const page = productContext.apiExamples?.find((item) => item.path === prose.path);
      if (!page && requestedSection && !prose.path.startsWith(`api/${requestedSection}/`))
        return withPending(apiPending(`path fora da seção pedida: ${prose.path}`));
      const endpoint = selectable.find((item) => publicEndpointId(item) === prose.endpoint);
      if (!endpoint) return withPending(apiPending(`endpoint fora da lista: ${prose.endpoint}`));
      if (page && !pageMatchesEndpoint(page, endpoint))
        return withPending(apiPending(`endpoint divergente da página publicada: ${prose.path}`));
      if (endpoint.documented && productContext.apiExamples?.some((item) => pageMatchesEndpoint(item, endpoint)) && !page) {
        return withPending(apiPending(`path divergente da página publicada: ${prose.path}`));
      }
      if (!endpoint.verb || !endpoint.route || !Array.isArray(endpoint.parameters)
        || !('responseFields' in endpoint) || !(endpoint.authorization ?? endpoint.policy)) {
        return withPending(apiPending(`fatos técnicos incompletos: ${prose.path}`));
      }
      usedEndpoints.add(prose.endpoint);
      const described = new Map();
      for (const item of prose.responseDescriptions ?? []) {
        if (!endpoint.responseFields?.some((field) => responseFieldPath(endpoint, field) === item.name) || described.has(item.name))
          return withPending(apiPending(`descrição de campo sem fato: ${item.name}`));
        described.set(item.name, renderUnit(item.description, parsed.articles, selectable));
      }
      const describedParameters = new Map();
      for (const item of prose.parameterDescriptions ?? []) {
        if (!endpoint.parameters.some((parameter) => parameter.name === item.name) || describedParameters.has(item.name))
          return withPending(apiPending(`descrição de parâmetro sem fato: ${item.name}`));
        describedParameters.set(item.name, renderUnit(item.description, parsed.articles, selectable));
      }
      const requestedRoute = explicitEndpointsFrom(request).find((item) => item.verb === endpoint.verb
        && [endpoint.route, ...(endpoint.optionalAliases ?? [])].some((route) =>
          route.replace(/^\/api\/v\d+/iu, '').toLowerCase().replace(/\{[^}]+\}/gu, '{}')
            === item.route.replace(/^\/api\/v\d+/iu, '').toLowerCase().replace(/\{[^}]+\}/gu, '{}')))?.route;
      const renderPage = page ?? { ...(productContext.apiExamples?.[0] ?? {}),
        ...(requestedRoute ? { frontmatter: { endpoint: requestedRoute.replace(/^\/api\/v\d+/iu, '') } } : {}),
        paramNames: undefined };
      const technical = renderApiReference(endpoint, productContext.apiExamples,
        { ...(renderPage ?? {}), responseDescriptions: Object.fromEntries(described),
          parameterDescriptions: Object.fromEntries(describedParameters) });
      const renderedParams = [...technical.body.matchAll(/<Param\s+[^>]*name="([^"]+)"/gu)].map((match) => match[1]);
      if (renderedParams.length !== endpoint.parameters.filter((item) => item.in !== 'route' || item.required !== false || technical.endpoint.toLowerCase().includes(`{${item.name.toLowerCase()}}`)).length) {
        return withPending(apiPending(`parâmetros renderizados sem correspondência com o fato: ${prose.path}`));
      }
      pending.push(...technical.pending);
      pending.push(...(endpoint.responseFields ?? []).filter((field) => !described.has(responseFieldPath(endpoint, field)))
        .map((field) => `descrição de resposta sem fonte: ${responseFieldPath(endpoint, field)}`));
      const body = [prose.intro, ...prose.notas].filter((unit) => unit.text)
        .map((unit) => renderUnit(unit, parsed.articles, selectable)).concat(technical.body).join('\n\n');
      const article = { path: prose.path, title: prose.title,
        description: renderUnit(prose.description, parsed.articles, selectable),
        source: technical.source, contentType: technical.contentType, method: technical.method,
        endpoint: technical.endpoint, body, productActions: [] };
      const validation = validateArticle(article);
      if (!validation.valid) return withPending(apiPending(`${prose.path}: ${validation.issues.join('; ')}`));
      factsByPath.set(article.path, endpoint);
      articles.push(article);
    }
    const withoutPage = selectable.map(publicEndpointId).find((id) => !usedEndpoints.has(id)
      && !apiPages?.pending.some((item) => item.startsWith(`${id}:`)));
    if (withoutPage) return withPending(apiPending(`endpoint sem página: ${withoutPage}`));
    return finalizeGeneratedPages(withPending({ ...safePackage, articles, discardedQuestions: plan.discardedQuestions ?? [],
      pending: [...new Set([...(productContext.pending ?? []), ...pending, ...(apiPages?.pending ?? [])])], existing, model: response.model }), request, factsByPath);
  }
  if (parsed.articles.some((article) => article.source === 'api' || /^api\//u.test(article.path ?? ''))) {
    return withPending(apiPending('página API exige fatos estruturados e módulo api'));
  }
  if (!faqRequested(request)) {
    const articleIssues = [
      ...groundingIssues(parsed, groundingContext(productContext, request, existing), ['summary']),
      ...parsed.articles.flatMap((article) => groundingIssues(article, groundingContext(productContext, request, existing), ['description', 'body', 'assistantOverview', 'assistantSuggestions'])),
    ];
    if (articleIssues.length) {
      if (!options.groundingRetryIssues) return generateContentPackage(root, request, { ...options, productContext, plan, groundingRetryIssues: articleIssues });
      return withPending(evidencePending(articleIssues));
    }
    const articles = parsed.articles.map(({ grounding: _grounding, ...article }) => attachScreenshotsToArticle({
      ...article, productActions: article.productActions.map(normalizeCatalogLabel),
      ...(request.tangoUrl && article.contentType === 'tutorial' ? { tangoUrl: request.tangoUrl } : {}),
    }, screenCaptureManifest, productContext.code?.find((item) => item.role === 'frontend')?.ref));
    const invalid = articles.map((article) => {
      const validation = validateArticle(article);
      const issues = [...validation.issues, ...article.productActions
        .filter((action) => !confirmedAction(action, request, productContext))
        .map((action) => `productActions ${action.id} não confirmada para o pedido e módulo`)];
      return { path: article.path, valid: issues.length === 0, issues };
    }).filter(({ valid }) => !valid);
    if (invalid.length) return withPending({ status: 'needs_information',
      summary: 'A IA gerou conteúdo que não passou pela validação editorial.',
      questions: invalid.flatMap(({ path, issues }) => issues.map((issue) => `${path}: ${issue}`)),
      articles: [], existing, model: response.model });
    return finalizeGeneratedPages(withPending({ ...safePackage, articles, existing, model: response.model }), request);
  }
  if (!parsed.articles.some((article) => article.contentType === 'faq' && /^docs\//u.test(article.path ?? '')))
    return withPending(apiPending('FAQ solicitada sem página FAQ em docs/'));
  const faqContext = { request, existing, support: productContext.support,
    business: productContext.businessContext,
    screenFacts: adaptScreenFacts({ facts: productContext.screenFacts, sha: productContext.code?.find((item) => item.role === 'frontend')?.ref }, productContext.coverage) };
  const sectionPending = [];
  const articles = [];
  for (const prose of parsed.articles) {
    if (!prose.sections?.passos?.some((item) => item?.acao)) {
      const checked = validateFreeFaqSections(prose.sections, faqContext);
      const missingTasks = missingFreeFaqTaskSteps(request, faqContext.screenFacts, checked.sections.passos);
      const destructiveIssues = checked.pending.filter((item) => item.includes('ação destrutiva fora de rótulo da tela'));
      if ((missingTasks.length || destructiveIssues.length) && !options.faqRetryIssues)
        return generateContentPackage(root, request, { ...options, productContext, plan,
          faqRetryIssues: [...missingTasks, ...destructiveIssues].map((item) => `${prose.path}: ${item}`) });
      if (checked.blocking.length) {
        if (!options.faqRetryIssues) return generateContentPackage(root, request, { ...options, productContext, plan,
          faqRetryIssues: checked.blocking });
        return withPending({ ...apiPending(`${prose.path}: travas rígidas: ${checked.blocking.join('; ')}`),
          pending: [...checked.pending, ...missingTasks] });
      }
      const materialize = (sections) => {
        const { sections: _sections, ...article } = prose;
        const direct = deterministicFaqAnswer(request, faqContext.screenFacts);
        article.body = [direct?.text, renderFreeFaqSections({ ...sections,
          suporte: fixedFaqSupportSection(request, faqContext.screenFacts) })].filter(Boolean).join('\n\n');
        article.description = `${(direct?.text ?? `Passos para usar ${request.topic} no iHelp.`).replace(/\*\*/gu, '')} Veja as tarefas e os passos nesta página.`.slice(0, 240);
        const firstStep = (sections.passos[0]?.passos[0]?.text ?? '').replace(/<\/?AConfirmar>/gu, '');
        article.assistantOverview = (firstStep.length >= 45 ? firstStep
          : `${direct?.text ?? ''} ${firstStep}`.trim()).slice(0, 200);
        article.assistantInitialSteps = firstStep ? 1 : 0;
        article.assistantSuggestions = ['Falar com uma pessoa?'];
        article.productActions = article.productActions.map(normalizeCatalogLabel);
        return article;
      };
      const preflight = materialize(checked.sections);
      const preflightIssues = [...validateArticle(preflight).issues, ...preflight.productActions
        .filter((action) => !confirmedAction(action, request, productContext))
        .map((action) => `productActions ${action.id} não confirmada para o pedido e módulo`)];
      if (preflightIssues.length) {
        if (!options.faqRetryIssues) return generateContentPackage(root, request, { ...options, productContext, plan,
          faqRetryIssues: preflightIssues });
        return withPending({ ...apiPending(`${prose.path}: ${preflightIssues.join('; ')}`), pending: checked.pending });
      }
      let judged;
      try {
        judged = await judgeClaims(checked.sections, faqContext, async (claims) => {
          const sources = { pedido: { topic: request.topic, module: request.module,
            description: request.description, details: request.details },
          facts: faqContext.screenFacts, business: faqContext.business, support: faqContext.support,
          pages: existing, prints: productContext.printManifest ?? [] };
          const judgeResponse = await modelResponse(options, baseRequest('juiz_faq', FAQ_JUDGE_SCHEMA, [
            { role: 'developer', content: 'Julgue CADA frase da página com as fontes. Retorne exatamente um item por id, na ordem. Classifique como sustentada, a confirmar ou contradiz a fonte. Suporte mostra dúvidas, mas não prova a resposta. Modelos de estilo não são fonte. Se faltar contexto de negócio para uma afirmação de negócio, marque a confirmar. Não omita frase. Dê motivo curto para pendência ou contradição.' },
            { role: 'user', content: redactPromptEvidence(JSON.stringify({ claims, sources }), productContext) },
          ], options), productContext, { request, existing });
          const parsedJudge = parseModelJson(judgeResponse);
          if (!parsedJudge.ok) throw new Error(`juiz: ${parsedJudge.reason}`);
          return parsedJudge.value;
        });
      } catch (error) {
        return withPending(apiPending(`${prose.path}: juiz inválido: ${error.message}`));
      }
      if (judged.contradictions.length && !options.faqRetryIssues) return generateContentPackage(root, request, {
        ...options, productContext, plan,
        faqRetryIssues: judged.contradictions.map((item) => `Contradição: ${item.text} — ${item.reason}. Reescreva com os fatos.`),
      });
      const article = materialize(judged.sections);
      sectionPending.push(...checked.pending, ...missingTasks.map((item) => `${prose.path}: ${item}`),
        ...judged.pending.map((item) => `${prose.path}: a confirmar: ${item}`));
      sectionPending.push(...faqTasksWithoutFacts(request, faqContext.screenFacts)
        .map((task) => `${prose.path}: tarefa sem fatos de tela: ${task}`));
      articles.push(article);
      continue;
    }
    const direct = deterministicFaqAnswer(request, faqContext.screenFacts);
    const result = validateFaqSections({ ...prose.sections, resposta: direct ? [direct] : [],
      suporte: [] }, faqContext);
    const missingTasks = missingFaqTaskSteps(request, faqContext.screenFacts, result.sections.passos ?? []);
    sectionPending.push(...result.pending.filter((item) => !item.includes(FAQ_SECTIONS.suporte))
      .map((item) => `${prose.path}: ${/Para que serve|Quando usar|Exemplo/u.test(item)
        ? `seção sem fonte de negócio: ${item}` : item}`));
    const uncovered = result.pending.filter((item) => item.startsWith('palavra sem fonte:')
      || item.startsWith('metanarração') || item.startsWith('ação incompatível:'));
    if ((uncovered.length || missingTasks.length) && !options.faqRetryIssues) return generateContentPackage(root, request, {
      ...options, productContext, plan, faqRetryIssues: [...uncovered, ...missingTasks].map((item) => `${prose.path}: ${item}`),
    });
    sectionPending.push(...missingTasks.map((item) => `${prose.path}: ${item}`));
    if (result.blocking.length) return withPending({ ...apiPending(`${prose.path}: faltam fontes para resposta direta ou passo principal${uncovered.length ? `; ${uncovered.join('; ')}` : ''}`),
      pending: sectionPending });
    const { sections: _sections, ...article } = prose;
    article.body = renderFaqSections({ ...result.sections,
      suporte: fixedFaqSupportSection(request, faqContext.screenFacts) });
    article.description = article.body.split('\n')[0].slice(0, 240);
    const firstStep = result.sections.passos[0]?.text ?? '';
    const directText = result.sections.resposta.map((unit) => unit.text).join(' ');
    article.assistantOverview = firstStep.length >= 45 && firstStep.length <= 200
      ? firstStep : `${directText} ${firstStep}`.trim().slice(0, 200);
    article.assistantInitialSteps = result.sections.passos.length ? 1 : 0;
    article.assistantSuggestions = ['Falar com uma pessoa?'];
    for (const fact of faqContext.screenFacts) if (fact.kind === 'route' && fact.routeTitle
      && fact.routeTitle !== fact.text && typeof article.assistantQuestion === 'string') {
      const before = article.assistantQuestion, at = before.indexOf(fact.routeTitle);
      if (at >= 0 && !/[\p{L}\p{N}]/u.test(before[at - 1] ?? '')
        && !/[\p{L}\p{N}]/u.test(before[at + fact.routeTitle.length] ?? ''))
        article.assistantQuestion = before.slice(0, at) + fact.text + before.slice(at + fact.routeTitle.length);
    }
    if (!validCanonicalQuestion(article.assistantQuestion)) {
      const screen = faqContext.screenFacts.find((fact) => fact.kind === 'route' && fact.text)?.text
        ?? request.module ?? prose.title ?? request.topic;
      const candidate = `Como uso a tela ${screen}?`;
      article.assistantQuestion = validCanonicalQuestion(candidate)
        ? candidate : `Como uso ${String(request.topic ?? prose.title).slice(0, 90)}?`;
    }
    article.productActions = article.productActions.map(normalizeCatalogLabel);
    if (request.tangoUrl && article.contentType === 'tutorial') article.tangoUrl = request.tangoUrl;
    articles.push(article);
  }
  for (let index = 0; index < articles.length; index++)
    articles[index] = attachScreenshotsToArticle(articles[index], screenCaptureManifest,
      productContext.code?.find((item) => item.role === 'frontend')?.ref);
  const invalid = articles.map((article) => {
    const validation = validateArticle(article);
    const issues = [...validation.issues, ...article.productActions
      .filter((action) => !confirmedAction(action, request, productContext))
      .map((action) => `productActions ${action.id} não confirmada para o pedido e módulo`)];
    return { path: article.path, valid: issues.length === 0, issues };
  }).filter(({ valid }) => !valid);
  if (invalid.length) {
    if (!options.faqRetryIssues) return generateContentPackage(root, request, { ...options, productContext, plan,
      faqRetryIssues: invalid.flatMap(({ path, issues }) => issues.map((issue) => `${path}: ${issue}`)) });
    return withPending({
      status: 'needs_information',
      summary: 'A IA gerou conteúdo que não passou pela validação editorial.',
      questions: invalid.flatMap(({ path, issues }) => issues.map((issue) => `${path}: ${issue}`)),
      articles: [], existing, model: response.model,
    });
  }
  return finalizeGeneratedPages(withPending({ ...safePackage, articles, existing, model: response.model,
    pending: sectionPending }), request);
}

const GUIDE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'questions', 'article'],
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_information'] },
    questions: { type: 'array', items: { type: 'string' } },
    article: {
      type: 'object', additionalProperties: false,
      required: [...ARTICLE_SCHEMA.required, 'guide'],
      properties: {
        ...ARTICLE_SCHEMA.properties,
        guide: { type: 'object', additionalProperties: false,
          required: ['schemaVersion', 'guideId', 'version', 'mode', 'initialStepId', 'steps'],
          properties: {
            schemaVersion: { type: 'integer' }, guideId: { type: 'string' }, version: { type: 'integer' },
            mode: { type: 'string', enum: ['real', 'treino'] }, initialStepId: { type: 'string' },
            steps: { type: 'array', items: { type: 'object', additionalProperties: false,
              required: ['stepId', 'text', 'actionId', 'choices'], properties: {
                stepId: { type: 'string' }, text: { type: 'string' },
                actionId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                choices: { type: 'array', items: { type: 'object', additionalProperties: false,
                  required: ['id', 'label', 'nextStepId'], properties: {
                    id: { type: 'string' }, label: { type: 'string' },
                    nextStepId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  } } },
              } } },
          } },
      },
    },
  },
};

export async function generateCanonicalGuide(root, request, options = {}) {
  checkRequest(request);
  const productContext = options.productContext;
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const existing = options.existingGuide;
  const response = await modelResponse(options, baseRequest('guia_canonico', GUIDE_SCHEMA, [
    { role: 'developer', content: [
      'Gere exatamente um artigo contentType=guia no contrato canônico. Use somente fatos citados do código e o plano aprovado.',
      'Mantenha guideId e path existentes quando houver atualização. Não invente botões, rotas, permissões ou ações.',
      'Use ações somente do catálogo. Para campo opcional ausente, use null ou lista vazia.',
      'Cada passo deve ser claro para iniciantes. Sem evidência suficiente, status=needs_information.',
      'Use somente dados fictícios como Ana Exemplo e Loja Exemplo. Nunca copie nomes de pessoas das respostas no draft.',
      'Cite cada frase de description, body, assistantOverview, assistantSuggestions e cada step.text no grounding do artigo com texto e citação exatos.',
    ].join(' ') },
    { role: 'user', content: redactPromptEvidence(`${requestText(request, existing ? [existing] : [], productContext)}\nGuideId: ${request.guideId}\nPlano aprovado: ${JSON.stringify(options.plan)}\nGuia anterior: ${JSON.stringify(existing ?? null)}`, productContext) },
  ], options), productContext, { request, existing: existing ? [existing] : [] });
  const modelJson = parseModelJson(response);
  if (!modelJson.ok) return apiPending(modelJson.reason);
  const parsed = modelJson.value;
  if (parsed.status !== 'ready') return { status: 'needs_information', questions: parsed.questions ?? [], articles: [], ...(parsed.internalCodeEcho ? { internalCodeEcho: parsed.internalCodeEcho } : {}) };
  const raw = parsed.article;
  const grounded = { grounding: raw.grounding, sentences: [raw.description, raw.body, raw.assistantOverview,
    ...raw.assistantSuggestions, ...raw.guide.steps.map((step) => step.text)] };
  if (!validateGroundedOutput(grounded, groundingContext(productContext, request), ['sentences'])) return evidencePending();
  const { grounding: _grounding, ...article } = raw;
  article.guide.steps = article.guide.steps.map((step) => ({ ...step,
    ...(step.actionId === null ? { actionId: undefined } : {}),
    choices: step.choices.map((choice) => ({ ...choice, ...(choice.nextStepId === null ? { nextStepId: undefined } : {}) })),
  }));
  if (article.guide.guideId !== request.guideId || article.contentType !== 'guia'
    || article.productActions.some((action) => !confirmedAction(action, request, productContext))) return evidencePending();
  const screenCaptureManifest = options.screenCaptureManifest ?? await loadScreenshotManifest(root);
  return finalizeGeneratedPages({ status: 'ready', articles: [attachScreenshotsToArticle(article, screenCaptureManifest,
    productContext.code?.find((item) => item.role === 'frontend')?.ref)],
    ...(parsed.internalCodeEcho ? { internalCodeEcho: parsed.internalCodeEcho } : {}) }, request);
}

export async function planContent(root, request, options = {}) {
  return withCodeRefreshOffer(await planContentCore(root, request, options));
}

export async function generateContentPackage(root, request, options = {}) {
  const result = await generateContentPackageCore(root, request, options);
  return withCodeRefreshOffer(finalizeSecurityResponse(result));
}
