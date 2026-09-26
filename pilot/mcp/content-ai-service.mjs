import OpenAI from 'openai';
import { searchContent, validateArticle } from './content-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { readArticle } from './editorial-standard.mjs';
import { containsSensitiveData, redactSensitiveData, sensitiveKinds } from './sensitive-data.mjs';
import { catalogActions, isCatalogAction } from './product-actions.mjs';
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';
import { createBudgetedResponse } from './provider-budget.mjs';

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

const routeShape = (route) => String(route ?? '').toLowerCase().replace(/\{[^}]+\}/gu, '{}');
const relativeRoute = (route) => String(route ?? '').replace(/^\/api\/v\d+/iu, '').toLowerCase();
const keysOf = (node) => Array.isArray(node) ? node.flatMap(keysOf)
  : node && typeof node === 'object' ? Object.entries(node).flatMap(([key, value]) => [key, ...keysOf(value)]) : [];
function apiIssues(article, context) {
  if (context.module !== 'api' && article.source !== 'api' && !/^api\//u.test(article.path ?? '')) return [];
  if (!context.endpoints?.length) return ['endpoints estruturados ausentes'];
  const versioned = /^\/api\/v\d+/iu.test(article.endpoint ?? '');
  const endpoint = context.endpoints.find((item) => item.verb === article.method &&
    (versioned ? item.route === article.endpoint : routeShape(relativeRoute(item.route)) === routeShape(article.endpoint)));
  if (!endpoint) return ['rota divergente: method/endpoint sem fato extraído'];
  if (endpoint.public !== undefined && !endpoint.public) return ['endpoint não público: confirmar'];
  const names = new Set(endpoint.parameters?.map(({ name }) => name.toLowerCase()) ?? []);
  const aliases = new Map();
  const claimedParts = relativeRoute(article.endpoint).split('/');
  const actualParts = relativeRoute(endpoint.route).split('/');
  for (let index = 0; index < claimedParts.length; index++) if (/^\{\w+\}$/u.test(claimedParts[index]) && /^\{\w+\}$/u.test(actualParts[index])) {
    const alias = claimedParts[index].slice(1, -1).toLowerCase();
    names.add(alias);
    aliases.set(alias, actualParts[index].slice(1, -1).toLowerCase());
  }
  const body = [article.title, article.description, article.body].filter(Boolean).join('\n');
  const requestNames = new Set([...names, ...aliases.keys()]);
  const responseNames = new Set((endpoint.responseFields ?? []).map(({ name }) => name.toLowerCase()));
  const general = new Set(['get', 'post', 'put', 'patch', 'delete', 'authorization', 'bearer', 'content-type', 'application/json', ...endpoint.route.split('/').map((part) => part.toLowerCase())]);
  const sections = body.split(/(?=^##\s+)/gmu);
  let response = false;
  for (const section of sections) {
    if (/^##\s*(?:resposta|response|campos relevantes|identificadores retornados)\b/iu.test(section)) response = true;
    else if (/^##\s*(?:requisição|request|parâmetros|parametros|campos do body|corpo da requisição)\b/iu.test(section)) response = false;
    const allowed = response ? responseNames : requestNames;
    const check = (name, kind) => {
      const value = name.toLowerCase();
      if (allowed.has(value) || general.has(value)) return null;
      if (response && endpoint.responseFields === null) return `campos de resposta não verificáveis: ${name}`;
      return `${kind}: ${name}`;
    };
    const routeText = section.replace(/https?:\/\/[^/\s"'`]+/gu, '').replace(/<\/?[A-Za-z][^>]*>/gu, '');
    for (const match of routeText.matchAll(/(?<![\w/])\/[A-Za-z][\w-]*(?:\/(?:[A-Za-z0-9_{}:-]+))*/gu)) {
      const route = match[0];
      if (route === '/json' && routeText.slice(Math.max(0, match.index - 11), match.index).endsWith('application')) continue;
      if (/^\/(?:docs|blog|tutoriais)\//u.test(route) && /\]\([^)]*$/u.test(routeText.slice(0, match.index))) continue;
      if (/^\/api\/v\d+/iu.test(route) ? route !== endpoint.route
        : routeShape(route) !== routeShape(relativeRoute(endpoint.route))) return [`rota divergente no artigo: ${route}`];
    }
    for (const match of section.matchAll(/[?&]([A-Za-z][\w]*)=/gu)) {
      const issue = check(match[1], response ? 'campo inexistente' : 'parâmetro inexistente');
      if (issue) return [issue];
    }
    for (const match of section.matchAll(/\b(?:campo|parâmetro|propriedade)\s+([A-Za-z][\w]*)/giu)) {
      const issue = check(match[1], response ? 'campo inexistente' : 'parâmetro inexistente');
      if (issue) return [issue];
    }
    for (const match of section.matchAll(/<Param\s+[^>]*name=["']([^"']+)["']/gu)) {
      const issue = check(match[1], response ? 'campo inexistente' : 'parâmetro inexistente');
      if (issue) return [issue];
    }
    for (const match of section.matchAll(/`([^`\n]+)`(?!`)/gu)) {
      const value = match[1];
      if (!/^[A-Za-z][\w-]*$/u.test(value)) continue;
      const issue = check(value, response ? 'campo inexistente' : 'parâmetro inexistente');
      if (issue) return [issue];
    }
    for (const match of section.matchAll(/```json\s*([\s\S]*?)```/gu)) {
      if (response && endpoint.responseFields === null) return ['campos de resposta não verificáveis'];
      let value;
      try { value = JSON.parse(match[1]); } catch { return ['JSON de resposta inválido']; }
      for (const key of keysOf(value)) {
        const issue = check(key, response ? 'campo inexistente' : 'parâmetro inexistente');
        if (issue) return [issue];
      }
    }
  }
  for (const match of body.matchAll(/<Param\s+([^>]+)>/gu)) {
    const name = match[1].match(/name=["']([^"']+)["']/u)?.[1];
    const type = match[1].match(/type=["']([^"']+)["']/u)?.[1];
    const fact = [...endpoint.parameters ?? [], ...endpoint.responseFields ?? []].find((item) => item.name.toLowerCase() === (aliases.get(name?.toLowerCase()) ?? name?.toLowerCase()));
    const expected = fact && (/^(?:int|long|double|decimal|float|short)$/iu.test(fact.type) ? 'number' : /^bool(?:ean)?$/iu.test(fact.type) ? 'boolean' : 'string');
    if (fact && type && expected !== type) return [`tipo divergente: ${name}`];
  }
  for (const match of body.matchAll(/^##\s+`?(GET|POST|PUT|PATCH|DELETE)`?\s*$/gmu)) if (match[1] !== endpoint.verb) return ['method divergente no artigo'];
  for (const match of body.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(?:https?:\/\/[^/\s]+)?(\/api\/v\d+\/[^\s`"']+|\/[a-z][\w/-]*(?:\{[^}]+\})?)/gu)) {
    const route = match[2].split('?')[0];
    if (match[1] !== endpoint.verb || (/^\/api\/v\d+/iu.test(route)
      ? route !== endpoint.route : routeShape(route) !== routeShape(relativeRoute(endpoint.route)))) return ['rota divergente no artigo'];
  }
  return [];
}

export function validateGroundedOutput(output, context, fields, issues = []) {
  const api = apiIssues(output, context);
  if (api.length) { issues.push(...api); return false; }
  if (!context.groundingRequired) return true;
  const claims = output.grounding;
  if (!Array.isArray(claims)) return false;
  const lines = fields.flatMap((field) => {
    const value = output[field];
    return (Array.isArray(value) ? value : [value]).filter((item) => typeof item === 'string')
      .flatMap((item) => item.split(/(?<=[.!?])\s+|\n/u).map((line) => line.trim()).filter(Boolean));
  });
  if (!lines.length || lines.some((line) => !claims.some((claim) => claim.text === line))) return false;
  return claims.length > 0 && claims.every((claim) => typeof claim.text === 'string'
    && lines.includes(claim.text) && Array.isArray(claim.citations) && claim.citations.length > 0
    && claim.citations.every((citation) => context.matches.some((match) =>
      citation.repository === match.repository && citation.path === match.path
      && citation.sha === match.sha && citation.sha === match.ref
      && Number.isInteger(citation.lineStart) && citation.lineStart === match.line
      && citation.lineEnd === match.line)));
}

function evidencePending() {
  return { status: 'needs_evidence', summary: 'A resposta não está vinculada às linhas do código recuperado.',
    questions: ['Confirme a fonte e as citações de cada afirmação.'], articles: [] };
}
function apiPending(reason) {
  return { status: 'needs_information', summary: reason, questions: [reason], articles: [] };
}
function explicitEndpoints(request) {
  return [...Object.values(request).filter((value) => typeof value === 'string').join(' ').matchAll(/(?:\/api\/v\d+)?\/(?:[A-Za-z][\w-]*\/)*[A-Za-z][\w-]*(?:\/\{\w+\})?/gu)]
    .map((match) => match[0]);
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
const API_ARTICLE_FIELDS = Object.fromEntries(Object.entries(ARTICLE_SCHEMA.properties)
  .filter(([key]) => !key.startsWith('assistant')));
const API_PACKAGE_SCHEMA = { ...PACKAGE_SCHEMA, properties: { ...PACKAGE_SCHEMA.properties,
  articles: { type: 'array', items: { ...ARTICLE_SCHEMA,
    required: [...ARTICLE_SCHEMA.required.filter((key) => !key.startsWith('assistant')), 'method', 'endpoint'],
    properties: { ...API_ARTICLE_FIELDS, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, endpoint: { type: 'string' } } } } } };

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
  const result = await createBudgetedResponse(client, payload, options.budget);
  if (result.kind !== 'ok') throw new Error(result.kind === 'budget_exhausted' ? 'Orçamento da IA esgotado' : 'Resposta da IA indisponível');
  return result.response;
}

function baseRequest(name, schema, input, options) {
  return {
    model: options.model ?? process.env.OPENAI_MODEL ?? 'gpt-6-luna',
    store: false,
    reasoning: { effort: 'medium' },
    max_output_tokens: 4_000,
    text: { format: { type: 'json_schema', name, strict: true, schema } },
    input,
  };
}

function parseJson(response) {
  const text = String(response.output_text ?? '').trim();
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

function requestText(request, existing, productContext) {
  const selectedEndpoints = (productContext.endpoints ?? []).filter((item) => item.documented || item.explicit);
  return [
    `Tema: ${request.topic}`,
    `Módulo: ${request.module}`,
    `Objetivo: ${request.description}`,
    `Público: ${request.audience ?? 'Cliente em trial sem treinamento'}`,
    `Detalhes confirmados: ${request.details ?? 'Nenhum detalhe adicional.'}`,
    request.productRoute ? `Rota confirmada no produto: ${request.productRoute}` : '',
    request.tangoUrl ? `Tango já existente: ${request.tangoUrl}` : '',
    `Documentação publicada semelhante (fonte editorial):\n${existing.length ? existing.map((item) => `- ${item.title} (${item.path}): ${item.description}\n${item.body ?? ''}`).join('\n') : '- Nenhum'}`,
    `Contexto dos codebases:\n${productContext.matches.length ? productContext.matches.map((item) => `REPOSITÓRIO ${item.repository}@${item.ref} (${item.role})\nARQUIVO ${redactSensitiveData(item.path)} LINHA ${item.line ?? 'não informada'} SHA ${item.sha ?? item.ref}\n${redactSensitiveData(item.excerpt)}`).join('\n\n') : '- Indisponível ou sem correspondências'}`,
    request.module === 'api' ? `FATOS ESTRUTURADOS DE ENDPOINTS (somente public=true é gerável):\n${JSON.stringify(selectedEndpoints.length ? selectedEndpoints : productContext.endpoints ?? [])}\nFORMATO REAL DAS PÁGINAS API:\n${JSON.stringify(productContext.apiExamples ?? [])}` : '',
    `Sinais agregados do suporte:\n${productContext.support?.categories?.length ? productContext.support.categories.map((item) => `- ${item.category}: ${item.guidance}`).join('\n') : '- Nenhum sinal específico'}`,
    `Regras do suporte:\n${productContext.support?.rules?.map((item) => `- ${item}`).join('\n') ?? '- Nenhuma'}`,
    `Matriz de cobertura:\n${productContext.coverage?.map((item) => `- ${item.module}: ${item.coverage}; rotas=${item.productRoutes.join(', ')}; permissão=${item.permission}`).join('\n') ?? '- Nenhuma correspondência'}`,
    `Catálogo confiável de ProductAction (id, label, route, target):\n${catalogActions().map((action) => JSON.stringify(action)).join('\n')}`,
  ].filter(Boolean).map(redactSensitiveData).join('\n');
}

function groundingPending(context) {
  if (!context.groundingRequired || (context.code.length && context.code.every(({ available }) => available) && context.matches.length)) return null;
  return {
    status: 'needs_information',
    summary: 'Código do produto indisponível ou sem evidência para este tema.',
    guidance: 'Código do produto indisponível ou sem evidência para este tema.',
    questions: ['Confirme os checkouts autorizados, seus SHAs e a implementação do tema.'],
    risks: [], suggestedActions: [], articles: [],
  };
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

export async function planContent(root, request, options = {}) {
  checkRequest(request);
  const existing = await related(root, request);
  const productContext = options.productContext ?? await getIhelpContext(root, request.topic, request.module, { ...options.contextOptions, requireLocal: true, ...(request.module === 'api' ? { repositoryIds: ['backend'] } : {}), explicitEndpoints: explicitEndpoints(request) }).catch(() => ({ groundingRequired: true, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] }));
  if (request.module === 'api' && !productContext.endpoints?.length) return apiPending(productContext.nonPublicEndpoints ? 'endpoint não público: confirmar' : 'endpoints estruturados ausentes');
  if (request.module === 'api' && !productContext.endpoints.some((item) => item.public)) return apiPending('endpoint não público: confirmar');
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const response = await modelResponse(options, baseRequest('plano_documentacao', PLAN_SCHEMA, [
    {
      role: 'developer',
      content: [
        'Você é a editora de conteúdo do iHelp. Oriente quem está criando documentação antes de escrever.',
        'O público final acabou de acessar o produto há 30 segundos, está em trial e não recebeu treinamento.',
        'Identifique conflitos, informação ausente, duplicidade e nomes de telas ou botões que precisam ser confirmados.',
        'Use status=needs_information quando faltar qualquer fato necessário; faça perguntas curtas e específicas. Não invente comportamento do produto.',
        'Sugira ações no produto somente com rota fornecida ou sustentada pelos detalhes. target é um identificador data-help-id estável, nunca um seletor CSS.',
        request.module === 'api' ? 'Planeje páginas de referência da API. Para tema amplo, foque nos endpoints documented=true. Não peça dados já presentes nos fatos estruturados. Endpoint sem public=true exige confirmação.' : 'O pacote final deve incluir uma FAQ curta, um tutorial completo, passos guiados no produto e navegação. Vídeo não faz parte do escopo.',
        'No modo com código, cada frase ou passo de guidance e risks precisa de um item grounding com texto idêntico e citações estruturadas do contexto: repository, path, lineStart, lineEnd, sha. Sem evidência, use needs_information.',
      ].join(' '),
    },
    { role: 'user', content: requestText(request, existing, productContext) },
  ], options));
  const parsed = parseJson(response);
  if (parsed.status === 'ready' && !validateGroundedOutput(parsed, productContext, ['guidance', 'risks'])) return { ...evidencePending(), pending: productContext.pending ?? [] };
  const { grounding: _grounding, ...safePlan } = parsed;
  return { ...safePlan, suggestedActions: parsed.suggestedActions.map(normalizeCatalogLabel), existing, pending: productContext.pending ?? [], productContext: { repositories: productContext.code?.map(({ repository, ref, role }) => ({ repository, ref, role })) ?? [], files: productContext.matches.map(({ repository, path, line, sha }) => `${repository}:${redactSensitiveData(path)}:${line ?? '?'}@${sha ?? '?'}`), supportCategories: productContext.support?.categories?.map(({ category }) => category) ?? [] }, model: response.model };
}

export async function generateContentPackage(root, request, options = {}) {
  checkRequest(request);
  const existing = await related(root, request);
  const productContext = options.productContext ?? await getIhelpContext(root, request.topic, request.module, { ...options.contextOptions, requireLocal: true, ...(request.module === 'api' ? { repositoryIds: ['backend'] } : {}), explicitEndpoints: explicitEndpoints(request) }).catch(() => ({ groundingRequired: true, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] }));
  const withPending = (result) => productContext.pending?.length ? { ...result, pending: productContext.pending } : result;
  if (request.module === 'api' && !productContext.endpoints?.length) return withPending(apiPending(productContext.nonPublicEndpoints ? 'endpoint não público: confirmar' : 'endpoints estruturados ausentes'));
  if (request.module === 'api' && !productContext.endpoints.some((item) => item.public)) return withPending(apiPending('endpoint não público: confirmar'));
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const plan = options.plan ?? await planContent(root, request, { ...options, productContext });
  if (plan.status !== 'ready') {
    return withPending({ status: plan.status, summary: plan.summary ?? plan.guidance, questions: plan.questions, articles: [], existing, model: plan.model });
  }
  const { pending: _pending, ...planForPrompt } = plan;
  const response = await modelResponse(options, baseRequest('pacote_documentacao', request.module === 'api' ? API_PACKAGE_SCHEMA : PACKAGE_SCHEMA, [
    {
      role: 'developer',
      content: [
        'Crie um pacote completo de documentação do iHelp usando apenas os fatos fornecidos.',
        request.module === 'api' ? 'O público da referência conhece HTTP. Descreva somente o contrato sustentado pelos fatos.' : 'O público acabou de acessar o iHelp há 30 segundos, está em trial e não recebeu treinamento. Nunca suponha que conhece menus, termos ou pré-requisitos.',
        request.module === 'api' ? 'Gere páginas api/ de referência apenas para endpoints com public=true nos fatos. Para tema amplo, gere os endpoints documented=true. Use source=api, contentType=referencia, method e endpoint do fato, com o formato das páginas API fornecidas. Não invente parâmetros ou campos. Se o endpoint não for público, responda needs_information com "endpoint não público: confirmar".' : 'Gere exatamente dois artigos quando o tema for operacional: uma FAQ em docs/ e um tutorial em tutoriais/. Ambos devem começar dizendo onde a pessoa está e onde deve clicar.',
        request.module === 'api' ? 'Organize método, endpoint, parâmetros e resposta nas seções reais da referência.' : 'Cada passo deve conter uma ação, o resultado visível e, quando necessário, como confirmar que funcionou. Não repita a mesma instrução em introdução, listas e passos.',
        'productActions liga o artigo ao produto. Use somente rotas confirmadas no pedido ou na cobertura do módulo; o plano da IA não confirma ações sozinho. Nunca gere vídeo, VideoEmbed, iframe, credencial, dado pessoal ou link legado.',
        'Use somente ProductAction do catálogo confiável no contexto, com id, label, route e target exatos. Não invente ação, rota nem target.',
        request.module === 'api' ? 'Não inclua campos assistant nas páginas de referência; siga o frontmatter das páginas API existentes.' : 'Em cada artigo preencha assistantQuestion com uma pergunta canônica, assistantOverview com orientação curta e útil a iniciante, assistantInitialSteps com 1 a 3 passos concretos presentes no body e assistantSuggestions com 1 a 3 próximas perguntas ou ações distintas. Não duplique passos.',
        request.module === 'api' ? 'Se faltar método, rota, parâmetros ou autorização, use needs_information e deixe articles vazio.' : 'Se houver conflito entre fontes ou faltar nome de botão, formato aceito, permissão ou resultado esperado, use status=needs_information, liste as perguntas e deixe articles vazio.',
        request.module === 'api' ? 'Cada body precisa ter pelo menos 60 palavras. Use as seções das páginas API reais como formato. Só cite campos de resposta quando estiverem presentes em responseFields; sem esses fatos, não gere JSON de resposta nem nomes de campos de resposta.' : 'Cada body precisa ter pelo menos 60 palavras, Markdown simples e linguagem concreta. FAQ responde rapidamente; tutorial ensina do início ao resultado final.',
        'No modo com código, cada frase ou passo de summary e de description, body, assistantOverview e assistantSuggestions em cada artigo precisa de item grounding com texto idêntico e citações estruturadas: repository, path, lineStart, lineEnd, sha. Sem evidência, use needs_information.',
      ].join(' '),
    },
    { role: 'user', content: redactSensitiveData(`${requestText(request, existing, productContext)}\n\nPlano aprovado:\n${JSON.stringify(planForPrompt)}`) },
  ], options));
  const parsed = parseJson(response);
  const { grounding: _grounding, ...safePackage } = parsed;
  if (parsed.status !== 'ready') return withPending({ ...safePackage, articles: [], existing, model: response.model });
  if (request.module === 'api' && !parsed.articles.length) return withPending(apiPending('nenhuma página de API gerada'));
  const groundingIssues = [];
  if (!validateGroundedOutput(parsed, productContext, ['summary']) || parsed.articles.some((article) =>
    !validateGroundedOutput(article, { ...productContext, module: request.module }, ['description', 'body', 'assistantOverview', 'assistantSuggestions'], groundingIssues))) {
    return withPending(groundingIssues.length ? apiPending(groundingIssues.join('; ')) : evidencePending());
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
  const parsed = parseJson(response);
  if (parsed.status !== 'ready') return { status: 'needs_information', questions: parsed.questions ?? [], articles: [] };
  const raw = parsed.article;
  const grounded = { grounding: raw.grounding, sentences: [raw.description, raw.body, raw.assistantOverview,
    ...raw.assistantSuggestions, ...raw.guide.steps.map((step) => step.text)] };
  if (!validateGroundedOutput(grounded, productContext, ['sentences'])) return evidencePending();
  const { grounding: _grounding, ...article } = raw;
  article.guide.steps = article.guide.steps.map((step) => ({ ...step,
    ...(step.actionId === null ? { actionId: undefined } : {}),
    choices: step.choices.map((choice) => ({ ...choice, ...(choice.nextStepId === null ? { nextStepId: undefined } : {}) })),
  }));
  if (article.guide.guideId !== request.guideId || article.contentType !== 'guia'
    || article.productActions.some((action) => !confirmedAction(action, request, productContext))) return evidencePending();
  return { status: 'ready', articles: [article] };
}
