import OpenAI from 'openai';
import { searchContent, validateArticle } from './content-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { readArticle } from './editorial-standard.mjs';
import { containsSensitiveData, redactSensitiveData, sensitiveKinds } from './sensitive-data.mjs';
import { catalogActions, isCatalogAction } from './product-actions.mjs';
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import { createBudgetedResponse } from './provider-budget.mjs';
import { renderApiReference } from './api-reference-render.mjs';
import { contentMaxOutputTokens } from './env-compat.mjs';
import { withCodeRefreshOffer } from './code-refresh-offer.mjs';
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

function proseIssue(article, endpoint) {
  const parameters = endpoint.parameters ?? [];
  const parameterNames = new Set(parameters.map((field) => field.name));
  const fieldNames = new Set([...parameters.filter((field) => field.in === 'body'), ...endpoint.responseFields ?? []]
    .map((field) => field.name));
  const headerNames = new Set(['Authorization', 'Content-Type']);
  const names = new Set([...parameterNames, ...fieldNames, ...headerNames]);
  const inlineNames = new Set([...parameterNames, ...fieldNames]);
  for (const route of [endpoint.route, ...(endpoint.optionalAliases ?? (endpoint.optionalAlias ? [endpoint.optionalAlias] : []))]) {
    for (const segment of (route ?? '').split('/')) {
      if (segment) names.add(segment.replace(/^\{([^}]+)\}$/u, '$1'));
    }
  }
  const token = '[\\p{L}\\p{N}_][\\p{L}\\p{N}_-]*';
  const labelledNames = new RegExp(`\\b(campos?|parâmetros?|propriedades?|atributos?|chaves?|headers?|cabeçalhos?)\\s+(?:(?:o|a|os|as|um|uma|de|do|da|dos|das|no|na|em)\\s+)*((?:\\x60?${token}\\x60?)(?:\\s*(?:,|\\be\\b)\\s*\\x60?${token}\\x60?)*)`, 'giu');
  const tokens = new RegExp(token, 'gu');
  for (const value of [article.title, article.description, article.intro, ...article.notas]) {
    if (typeof value !== 'string') return 'prosa inválida';
    const block = value.includes('```') ? value.match(/```[^\n]*/u) : null;
    if (block) return `bloco de código proibido: ${block[0].slice(0, 80)}`;
    const component = value.match(/<\/?[A-Za-z][^>]*>/u);
    if (component) return `componente proibido: ${component[0]}`;
    const path = value.match(/\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_{}-]+)*/u);
    if (path) return `caminho proibido: ${path[0]}`;
    for (const code of value.matchAll(/`([^`\n]+)`/gu)) {
      if (!inlineNames.has(code[1])) return `código inline proibido: ${code[0]}`;
    }
    const method = value.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\b/iu);
    if (method) return `método proibido na prosa: ${method[0]}`;
    for (const labelled of value.matchAll(labelledNames)) {
      const allowed = /^(?:campos?|propriedades?|atributos?|chaves?)$/iu.test(labelled[1])
        ? fieldNames : /^parâmetros?$/iu.test(labelled[1]) ? parameterNames : headerNames;
      for (const candidate of labelled[2].matchAll(new RegExp(`(\\x60?)(${token})\\x60?`, 'gu'))) {
        const name = candidate[2];
        const factual = [...allowed].some((fact) => fact.toLowerCase() === name.toLowerCase());
        const technical = Boolean(candidate[1]) || /(?<=\p{L})\p{Lu}|\p{L}_\p{L}|(?=.*\p{L})(?=.*\p{N})/u.test(name)
          || [...names].some((fact) => fact.toLowerCase() === name.toLowerCase());
        if (technical && !factual) return `nome técnico sem fato: ${name}`;
      }
    }
    for (const [name] of value.matchAll(tokens)) {
      const identifier = /\p{Ll}\p{Lu}|\p{L}_\p{L}/u.test(name)
        || (/\p{L}/u.test(name) && /\d/u.test(name));
      if (identifier && !names.has(name)) return `nome técnico sem fato: ${name}`;
    }
  }
  return null;
}
function apiSchemaIssue(article) {
  if (!article || typeof article !== 'object' || Array.isArray(article)) return 'schema de prosa inválido';
  const allowed = new Set(['path', 'endpoint', 'title', 'description', 'intro', 'notas', 'grounding']);
  const extra = Object.keys(article).find((key) => !allowed.has(key));
  if (extra) return `campo da IA não permitido: ${extra}`;
  if (typeof article.path !== 'string' || typeof article.endpoint !== 'string' || typeof article.title !== 'string'
    || typeof article.description !== 'string' || typeof article.intro !== 'string'
    || !Array.isArray(article.notas) || !article.notas.every((item) => typeof item === 'string')
    || !Array.isArray(article.grounding)) return 'schema de prosa inválido';
  if (!/^api\/[a-z0-9][a-z0-9/-]*$/u.test(article.path)) return `path API inválido: ${article.path}`;
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
        const literal = normalizeSpaces(source);
        if (literal.includes(segment)) return true;
        return index === segments.length - 1 && !/[.!?;]$/u.test(segment)
          && [...literal.matchAll(new RegExp(`${segment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[.!?;]`, 'gu'))].length > 0;
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
        issues.push(`linha fora do índice: ${citation?.path ?? ''}:${citation?.lineStart ?? '?'}`);
      }
    }
  }
  return [...new Set(issues)];
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
  return [...context.matches ?? [], ...(context.endpoints ?? []).flatMap((endpoint) => [
    endpoint.source, endpoint.routeSource, endpoint.actionRouteSource, endpoint.verbSource,
    endpoint.authorizationSource, ...(endpoint.parameters ?? []).map((item) => item.source),
    ...(endpoint.responseFields ?? []).map((item) => item.source),
  ].map((source) => provenance(endpoint, source)).filter(Boolean))];
}

function groundingContext(productContext, request, existing) {
  return { ...productContext, module: request.module, request, existing };
}

function evidencePending(issues = []) {
  return { status: 'needs_evidence', summary: `A resposta não está vinculada às linhas do código recuperado.${issues.length ? ` ${issues.join('; ')}` : ''}`,
    questions: ['Confirme a fonte e as citações de cada afirmação.'], articles: [] };
}

function retryPrompt(issues) {
  return { role: 'developer', content: redactSensitiveData(`O validador recusou estas citações. Corrija cada uma usando apenas fontes listadas: ${issues.join('; ')}`) };
}
function apiPending(reason) {
  return { status: 'needs_information', summary: reason, questions: [reason], articles: [] };
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
  required: ['path', 'endpoint', 'title', 'description', 'intro', 'notas', 'grounding'],
  properties: { path: { type: 'string' }, endpoint: { type: 'string', enum: [] }, title: { type: 'string' }, description: { type: 'string' },
    intro: { type: 'string' }, notas: { type: 'array', items: { type: 'string' } }, grounding: API_GROUNDING_SCHEMA },
};
const API_PACKAGE_SCHEMA = { ...PACKAGE_SCHEMA, properties: { ...PACKAGE_SCHEMA.properties,
  articles: { type: 'array', items: API_ARTICLE_SCHEMA }, grounding: API_GROUNDING_SCHEMA } };

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

async function modelResponse(options, payload) {
  const client = clientOf(options);
  if (options.client && !options.budget) return client.responses.create(payload);
  const result = await createBudgetedResponse(client, payload, { ...options.budget, acceptIncomplete: true });
  if (result.kind !== 'ok') throw new Error(result.kind === 'budget_exhausted' ? 'Orçamento da IA esgotado' : 'Resposta da IA indisponível');
  return result.response;
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

function requestText(request, existing, productContext) {
  const explicit = explicitEndpointsFrom(request).length > 0;
  const selectedEndpoints = (productContext.endpoints ?? []).filter((item) => explicit ? item.explicit : item.documented);
  return [
    `Tema: ${request.topic}`,
    `Módulo: ${request.module}`,
    `<<PEDIDO>>\n${request.description}${request.details ? `\n${request.details}` : ''}\n<<FIM DO PEDIDO>>`,
    `Público: ${request.audience ?? 'Cliente em trial sem treinamento'}`,
    request.productRoute ? `Rota confirmada no produto: ${request.productRoute}` : '',
    request.tangoUrl ? `Tango já existente: ${request.tangoUrl}` : '',
    `Documentação publicada semelhante (fonte editorial):\n${existing.length ? existing.map((item) => `- ${item.title} (${item.path}): ${item.description}${item.body ? `\n${item.body}` : ''}`).join('\n') : '- Nenhum'}`,
    `Contexto dos codebases:\n${productContext.matches.length ? productContext.matches.map((item) => `REPOSITÓRIO ${item.repository}@${item.ref} (${item.role})\nARQUIVO ${redactSensitiveData(item.path)} LINHA ${item.line ?? 'não informada'} SHA ${item.sha ?? item.ref}\n${redactSensitiveData(item.excerpt)}`).join('\n\n') : '- Indisponível ou sem correspondências'}`,
    request.module === 'api' ? `FATOS ESTRUTURADOS DE ENDPOINTS (somente public=true é gerável):\n${JSON.stringify(selectedEndpoints.length ? selectedEndpoints : productContext.endpoints ?? [])}\nFORMATO REAL DAS PÁGINAS API:\n${JSON.stringify(productContext.apiExamples ?? [])}` : '',
    `Sinais agregados do suporte:\n${productContext.support?.categories?.length ? productContext.support.categories.map((item) => `- ${item.category}: ${item.guidance}`).join('\n') : '- Nenhum sinal específico'}`,
    `Regras do suporte:\n${productContext.support?.rules?.map((item) => `- ${item}`).join('\n') ?? '- Nenhuma'}`,
    `Matriz de cobertura:\n${productContext.coverage?.map((item) => `- ${item.module}: ${item.coverage}; rotas=${item.productRoutes.join(', ')}; permissão=${item.permission}`).join('\n') ?? '- Nenhuma correspondência'}`,
    `Catálogo confiável de ProductAction (id, label, route, target):\n${catalogActions().map((action) => JSON.stringify(action)).join('\n')}`,
  ].filter(Boolean).map(redactSensitiveData).join('\n');
}

function pageMatchesEndpoint(page, endpoint) {
  return page?.frontmatter?.method && page?.frontmatter?.endpoint && endpoint.verb === page.frontmatter.method && [endpoint.route, ...(endpoint.optionalAliases ?? (endpoint.optionalAlias ? [endpoint.optionalAlias] : []))]
    .some((route) => route.replace(/^\/api\/v\d+/iu, '').toLowerCase().replace(/\{[^}]+\}/gu, '{}')
      === page.frontmatter.endpoint.toLowerCase().replace(/\{[^}]+\}/gu, '{}'));
}

function publicEndpointId(endpoint) {
  return `${endpoint.verb} ${endpoint.route.replace(/^\/api\/v\d+/iu, '')}`;
}

function groundingPending(context) {
  const missingCitation = context.pending?.filter((item) => item.startsWith('endpoint citado não encontrado')) ?? [];
  if (missingCitation.length) return { status: 'needs_information', summary: missingCitation.join('; '),
    questions: missingCitation, articles: [], pending: context.pending };
  if (!context.groundingRequired || (context.code.length && context.code.every(({ available }) => available) && context.matches.length)) return null;
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
  if (productContext.pending?.some((item) => item.startsWith('endpoint citado não encontrado'))) return groundingPending(productContext);
  if (request.module === 'api' && !productContext.endpoints?.length) return apiPending(productContext.nonPublicEndpoints ? 'endpoint não público: confirmar' : 'endpoints estruturados ausentes');
  if (request.module === 'api' && !productContext.endpoints.some((item) => item.public)) return apiPending('endpoint não público: confirmar');
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const response = await modelResponse(options, baseRequest('plano_documentacao', request.module === 'api'
    ? { ...PLAN_SCHEMA, properties: { ...PLAN_SCHEMA.properties, grounding: API_GROUNDING_SCHEMA } } : PLAN_SCHEMA, [
    {
      role: 'developer',
      content: [
        'Você é a editora de conteúdo do iHelp. Oriente quem está criando documentação antes de escrever.',
        'O público final acabou de acessar o produto há 30 segundos, está em trial e não recebeu treinamento.',
        'Identifique conflitos, informação ausente, duplicidade e nomes de telas ou botões que precisam ser confirmados.',
        'Use status=needs_information quando faltar qualquer fato necessário; faça perguntas curtas e específicas. Não invente comportamento do produto.',
        'Sugira ações no produto somente com rota fornecida ou sustentada pelos detalhes. target é um identificador data-help-id estável, nunca um seletor CSS.',
        request.module === 'api' ? 'Planeje páginas de referência da API. Para tema amplo, foque nos endpoints documented=true. Não peça dados já presentes nos fatos estruturados. Endpoint sem public=true exige confirmação. responseFields=null não bloqueia: a resposta exibirá nota fixa e pendência.' : 'O pacote final deve incluir uma FAQ curta, um tutorial completo, passos guiados no produto e navegação. Vídeo não faz parte do escopo.',
        request.module === 'api' ? 'Guidance e risks são orientação interna e não precisam de grounding por frase. Nunca são publicados. Podem mencionar métodos e nomes técnicos para orientar a geração; o schema é a única validação desta resposta. A prosa publicada será validada com grounding completo na geração.' : 'No modo com código, cada frase ou passo de guidance e risks precisa de um item grounding com texto idêntico e citações estruturadas do contexto: repository, path, lineStart, lineEnd, sha. Sem evidência, use needs_information.',
      ].join(' '),
    },
    { role: 'user', content: requestText(request, existing, productContext) },
    ...(options.groundingRetryIssues ? [retryPrompt(options.groundingRetryIssues)] : []),
  ], options));
  const modelJson = parseModelJson(response);
  if (!modelJson.ok) return { ...apiPending(modelJson.reason), pending: productContext.pending ?? [] };
  const parsed = modelJson.value;
  if (parsed.status === 'ready') {
    const issues = request.module === 'api' ? []
      : groundingIssues(parsed, groundingContext(productContext, request, existing), ['guidance', 'risks']);
    if (issues.length) {
      if (!options.groundingRetryIssues) return planContent(root, request, { ...options, productContext, groundingRetryIssues: issues });
      return { ...evidencePending(issues), pending: productContext.pending ?? [] };
    }
  }
  const { grounding: _grounding, ...safePlan } = parsed;
  return { ...safePlan, suggestedActions: parsed.suggestedActions.map(normalizeCatalogLabel), existing, pending: productContext.pending ?? [], productContext: { repositories: productContext.code?.map(({ repository, ref, role }) => ({ repository, ref, role })) ?? [], files: productContext.matches.map(({ repository, path, line, sha }) => `${repository}:${redactSensitiveData(path)}:${line ?? '?'}@${sha ?? '?'}`), supportCategories: productContext.support?.categories?.map(({ category }) => category) ?? [] }, model: response.model };
}

async function generateContentPackageCore(root, request, options = {}) {
  checkRequest(request);
  const existing = await related(root, request);
  const productContext = options.productContext ?? await getIhelpContext(root, request.topic, request.module, { ...options.contextOptions, requireLocal: true, ...(request.module === 'api' ? { repositoryIds: ['backend'] } : {}), explicitEndpoints: explicitEndpointsFrom(request) }).catch(() => ({ groundingRequired: true, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] }));
  const withPending = (result) => ({ ...result, pending: [...new Set([...(productContext.pending ?? []), ...(result.pending ?? [])])] });
  if (productContext.pending?.some((item) => item.startsWith('endpoint citado não encontrado'))) return groundingPending(productContext);
  if (request.module === 'api' && !productContext.endpoints?.length) return withPending(apiPending(productContext.nonPublicEndpoints ? 'endpoint não público: confirmar' : 'endpoints estruturados ausentes'));
  if (request.module === 'api' && !productContext.endpoints.some((item) => item.public)) return withPending(apiPending('endpoint não público: confirmar'));
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const plan = options.plan ?? await planContent(root, request, { ...options, productContext });
  if (plan.status !== 'ready') {
    return withPending({ status: plan.status, summary: plan.summary ?? plan.guidance, questions: plan.questions, articles: [], existing, model: plan.model });
  }
  const { pending: _pending, ...planForPrompt } = plan;
  const explicit = request.module === 'api' && explicitEndpointsFrom(request).length > 0;
  const selectable = request.module === 'api' ? productContext.endpoints.filter((item) => item.public && (explicit ? item.explicit : item.documented)) : [];
  if (request.module === 'api' && !selectable.length) return withPending(apiPending('endpoint não público: confirmar'));
  const apiSchema = { ...API_PACKAGE_SCHEMA, properties: { ...API_PACKAGE_SCHEMA.properties,
    articles: { type: 'array', items: { ...API_ARTICLE_SCHEMA, properties: { ...API_ARTICLE_SCHEMA.properties,
      endpoint: { type: 'string', enum: selectable.map(publicEndpointId) } } } } } };
  const response = await modelResponse(options, baseRequest('pacote_documentacao', request.module === 'api' ? apiSchema : PACKAGE_SCHEMA, [
    {
      role: 'developer',
      content: [
        'Crie um pacote completo de documentação do iHelp usando apenas os fatos fornecidos.',
        request.module === 'api' ? 'O público da referência conhece HTTP. Descreva somente o contrato sustentado pelos fatos.' : 'O público acabou de acessar o iHelp há 30 segundos, está em trial e não recebeu treinamento. Nunca suponha que conhece menus, termos ou pré-requisitos.',
        request.module === 'api' ? 'Escreva path, endpoint, title, description, intro e notas para endpoints públicos. Escolha endpoint exatamente da lista fechada do schema, um endpoint distinto por artigo. A ordem dos artigos deve seguir a ordem dos fatos. Não escreva método, rota, parâmetros, resposta, componentes, frontmatter ou código. Se o endpoint não for público, responda needs_information com "endpoint não público: confirmar".' : 'Gere exatamente dois artigos quando o tema for operacional: uma FAQ em docs/ e um tutorial em tutoriais/. Ambos devem começar dizendo onde a pessoa está e onde deve clicar.',
        request.module === 'api' ? 'A parte técnica será renderizada dos fatos depois da sua resposta.' : 'Cada passo deve conter uma ação, o resultado visível e, quando necessário, como confirmar que funcionou. Não repita a mesma instrução em introdução, listas e passos.',
        request.module === 'api' ? '' : 'productActions liga o artigo ao produto. Use somente rotas confirmadas no pedido ou na cobertura do módulo; o plano da IA não confirma ações sozinho. Nunca gere vídeo, VideoEmbed, iframe, credencial, dado pessoal ou link legado.',
        request.module === 'api' ? '' : 'Use somente ProductAction do catálogo confiável no contexto, com id, label, route e target exatos. Não invente ação, rota nem target.',
        request.module === 'api' ? 'Não inclua campos assistant nem campos técnicos nas páginas de referência.' : 'Em cada artigo preencha assistantQuestion com uma pergunta canônica, assistantOverview com orientação curta e útil a iniciante, assistantInitialSteps com 1 a 3 passos concretos presentes no body e assistantSuggestions com 1 a 3 próximas perguntas ou ações distintas. Não duplique passos.',
        request.module === 'api' ? 'Se faltar método, rota, parâmetros ou autorização, use needs_information e deixe articles vazio. responseFields=null é permitido: a resposta terá nota fixa e pendência.' : 'Se houver conflito entre fontes ou faltar nome de botão, formato aceito, permissão ou resultado esperado, use status=needs_information, liste as perguntas e deixe articles vazio.',
        request.module === 'api' ? 'A prosa não pode conter método HTTP, caminho, bloco de código, componente JSX nem código inline, exceto nome exato de parâmetro ou campo dos fatos.' : 'Cada body precisa ter pelo menos 60 palavras, Markdown simples e linguagem concreta. FAQ responde rapidamente; tutorial ensina do início ao resultado final.',
        request.module === 'api' ? 'Cite cada frase de summary, description, intro e notas com grounding estruturado. source: "pedido" só pode citar trecho literal dentro de <<PEDIDO>>...<<FIM DO PEDIDO>>; source: "pagina" só pode citar trecho literal de página publicada listada no contexto, com path e quote. Cada quote deve ter pelo menos 12 caracteres. Para fatos técnicos, cite o código com repository, path, lineStart, lineEnd e sha. O JSON interno de formato não é fonte. O pedido não confirma nomes de parâmetros nem campos; estes precisam existir nos fatos do código.' : 'No modo com código, cada frase ou passo de summary e de description, body, assistantOverview e assistantSuggestions em cada artigo precisa de item grounding com texto idêntico e citações estruturadas: repository, path, lineStart, lineEnd, sha. Sem evidência, use needs_information.',
      ].filter(Boolean).join(' '),
    },
    { role: 'user', content: redactSensitiveData(`${requestText(request, existing, productContext)}\n\nPlano aprovado:\n${JSON.stringify(planForPrompt)}`) },
    ...(options.groundingRetryIssues ? [retryPrompt(options.groundingRetryIssues)] : []),
  ], options));
  const modelJson = parseModelJson(response);
  if (!modelJson.ok) return withPending(apiPending(modelJson.reason));
  const parsed = modelJson.value;
  const { grounding: _grounding, ...safePackage } = parsed;
  if (parsed.status !== 'ready') return withPending({ ...safePackage, articles: [], existing, model: response.model });
  if (!Array.isArray(parsed.articles)) return withPending(apiPending('schema de artigos inválido'));
  if (request.module === 'api' && !parsed.articles.length) return withPending(apiPending('nenhuma página de API gerada'));
  if (request.module === 'api') {
    if (!productContext.apiExamples?.length) return withPending(apiPending('formato da referência API indisponível'));
    const articles = [];
    const usedEndpoints = new Set();
    const pending = [];
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
      const issue = proseIssue(prose, endpoint);
      if (issue) return withPending(apiPending(issue));
      const issues = groundingIssues(prose, groundingContext(productContext, request, existing), ['description', 'intro', 'notas']);
      if (issues.length) {
        if (!options.groundingRetryIssues) return generateContentPackage(root, request, { ...options, productContext, plan, groundingRetryIssues: issues });
        return withPending(evidencePending(issues));
      }
      const technical = renderApiReference(endpoint, productContext.apiExamples, page);
      const renderedParams = [...technical.body.matchAll(/<Param\s+[^>]*name="([^"]+)"/gu)].map((match) => match[1]);
      if (renderedParams.length !== endpoint.parameters.length) {
        return withPending(apiPending(`parâmetros renderizados sem correspondência com o fato: ${prose.path}`));
      }
      pending.push(...technical.pending);
      const body = [prose.intro, ...prose.notas, technical.body].filter(Boolean).join('\n\n');
      const article = { path: prose.path, title: prose.title, description: prose.description,
        source: technical.source, contentType: technical.contentType, method: technical.method,
        endpoint: technical.endpoint, body, productActions: [] };
      const validation = validateArticle(article);
      if (!validation.valid) return withPending(apiPending(`${prose.path}: ${validation.issues.join('; ')}`));
      articles.push(article);
    }
    const withoutPage = selectable.map(publicEndpointId).find((id) => !usedEndpoints.has(id));
    if (withoutPage) return withPending(apiPending(`endpoint sem página: ${withoutPage}`));
    const summaryIssue = proseIssue({ title: parsed.summary, description: '', intro: '', notas: [] }, { parameters: [], responseFields: [] });
    if (summaryIssue) return withPending(apiPending(summaryIssue));
    const summaryIssues = groundingIssues(parsed, groundingContext(productContext, request, existing), ['summary']);
    if (summaryIssues.length) {
      if (!options.groundingRetryIssues) return generateContentPackage(root, request, { ...options, productContext, plan, groundingRetryIssues: summaryIssues });
      return withPending(evidencePending(summaryIssues));
    }
    return withPending({ ...safePackage, articles, pending: [...new Set([...(productContext.pending ?? []), ...pending])], existing, model: response.model });
  }
  if (parsed.articles.some((article) => article.source === 'api' || /^api\//u.test(article.path ?? ''))) {
    return withPending(apiPending('página API exige fatos estruturados e módulo api'));
  }
  const articleIssues = [
    ...groundingIssues(parsed, groundingContext(productContext, request, existing), ['summary']),
    ...parsed.articles.flatMap((article) => groundingIssues(article, groundingContext(productContext, request, existing), ['description', 'body', 'assistantOverview', 'assistantSuggestions'])),
  ];
  if (articleIssues.length) {
    if (!options.groundingRetryIssues) return generateContentPackage(root, request, { ...options, productContext, plan, groundingRetryIssues: articleIssues });
    return withPending(evidencePending(articleIssues));
  }
  const articles = parsed.articles.map(({ grounding: _grounding, ...article }) => ({
    ...article,
    productActions: article.productActions.map(normalizeCatalogLabel),
    ...(request.tangoUrl && article.contentType === 'tutorial' ? { tangoUrl: request.tangoUrl } : {}),
  }));
  const invalid = articles.map((article) => {
    const validation = validateArticle(article);
    const issues = [...validation.issues, ...article.productActions
      .filter((action) => !confirmedAction(action, request, productContext))
      .map((action) => `productActions ${action.id} não confirmada para o pedido e módulo`)];
    return { path: article.path, valid: issues.length === 0, issues };
  }).filter(({ valid }) => !valid);
  if (invalid.length) {
    return withPending({
      status: 'needs_information',
      summary: 'A IA gerou conteúdo que não passou pela validação editorial.',
      questions: invalid.flatMap(({ path, issues }) => issues.map((issue) => `${path}: ${issue}`)),
      articles: [], existing, model: response.model,
    });
  }
  return withPending({ ...safePackage, articles, existing, model: response.model });
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
    { role: 'user', content: redactSensitiveData(`${requestText(request, existing ? [existing] : [], productContext)}\nGuideId: ${request.guideId}\nPlano aprovado: ${JSON.stringify(options.plan)}\nGuia anterior: ${JSON.stringify(existing ?? null)}`) },
  ], options));
  const modelJson = parseModelJson(response);
  if (!modelJson.ok) return apiPending(modelJson.reason);
  const parsed = modelJson.value;
  if (parsed.status !== 'ready') return { status: 'needs_information', questions: parsed.questions ?? [], articles: [] };
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
  return { status: 'ready', articles: [article] };
}

export async function planContent(root, request, options = {}) {
  return withCodeRefreshOffer(await planContentCore(root, request, options));
}

export async function generateContentPackage(root, request, options = {}) {
  return withCodeRefreshOffer(await generateContentPackageCore(root, request, options));
}
