import OpenAI from 'openai';
import { searchContent, validateArticle } from './content-service.mjs';
import { getIhelpContext } from './product-context-service.mjs';
import { readArticle } from './editorial-standard.mjs';
import { containsSensitiveData, redactSensitiveData, sensitiveKinds } from './sensitive-data.mjs';
import { catalogActions, isCatalogAction } from './product-actions.mjs';
import { resolveCatalogAction } from '../architecture/catalog-action.mjs';

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
  required: ['status', 'guidance', 'questions', 'risks', 'suggestedActions'],
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_information'] },
    guidance: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    suggestedActions: { type: 'array', items: actionSchema },
  },
};

const ARTICLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'title', 'description', 'source', 'contentType', 'body', 'productActions', 'assistantQuestion', 'assistantOverview', 'assistantInitialSteps', 'assistantSuggestions'],
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
  },
};

const PACKAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'questions', 'articles'],
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_information'] },
    summary: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    articles: { type: 'array', items: ARTICLE_SCHEMA },
  },
};

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
  const productContext = options.productContext ?? await getIhelpContext(root, request.topic, request.module, options.contextOptions).catch(() => ({ groundingRequired: true, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] }));
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const response = await clientOf(options).responses.create(baseRequest('plano_documentacao', PLAN_SCHEMA, [
    {
      role: 'developer',
      content: [
        'Você é a editora de conteúdo do iHelp. Oriente quem está criando documentação antes de escrever.',
        'O público final acabou de acessar o produto há 30 segundos, está em trial e não recebeu treinamento.',
        'Identifique conflitos, informação ausente, duplicidade e nomes de telas ou botões que precisam ser confirmados.',
        'Use status=needs_information quando faltar qualquer fato necessário; faça perguntas curtas e específicas. Não invente comportamento do produto.',
        'Sugira ações no produto somente com rota fornecida ou sustentada pelos detalhes. target é um identificador data-help-id estável, nunca um seletor CSS.',
        'O pacote final deve incluir uma FAQ curta, um tutorial completo, passos guiados no produto e navegação. Vídeo não faz parte do escopo.',
      ].join(' '),
    },
    { role: 'user', content: requestText(request, existing, productContext) },
  ], options));
  const parsed = parseJson(response);
  return { ...parsed, suggestedActions: parsed.suggestedActions.map(normalizeCatalogLabel), existing, productContext: { repositories: productContext.code?.map(({ repository, ref, role }) => ({ repository, ref, role })) ?? [], files: productContext.matches.map(({ repository, path, line, sha }) => `${repository}:${redactSensitiveData(path)}:${line ?? '?'}@${sha ?? '?'}`), supportCategories: productContext.support?.categories?.map(({ category }) => category) ?? [] }, model: response.model };
}

export async function generateContentPackage(root, request, options = {}) {
  checkRequest(request);
  const existing = await related(root, request);
  const productContext = options.productContext ?? await getIhelpContext(root, request.topic, request.module, options.contextOptions).catch(() => ({ groundingRequired: true, matches: [], code: [], support: { categories: [], rules: [] }, coverage: [] }));
  const pending = groundingPending(productContext);
  if (pending) return pending;
  const plan = options.plan ?? await planContent(root, request, { ...options, productContext });
  if (plan.status === 'needs_information') {
    return { status: 'needs_information', summary: plan.guidance, questions: plan.questions, articles: [], existing, model: plan.model };
  }
  const response = await clientOf(options).responses.create(baseRequest('pacote_documentacao', PACKAGE_SCHEMA, [
    {
      role: 'developer',
      content: [
        'Crie um pacote completo de documentação do iHelp usando apenas os fatos fornecidos.',
        'O público acabou de acessar o iHelp há 30 segundos, está em trial e não recebeu treinamento. Nunca suponha que conhece menus, termos ou pré-requisitos.',
        'Gere exatamente dois artigos quando o tema for operacional: uma FAQ em docs/ e um tutorial em tutoriais/. Ambos devem começar dizendo onde a pessoa está e onde deve clicar.',
        'Cada passo deve conter uma ação, o resultado visível e, quando necessário, como confirmar que funcionou. Não repita a mesma instrução em introdução, listas e passos.',
        'productActions liga o artigo ao produto. Use somente rotas confirmadas no pedido ou na cobertura do módulo; o plano da IA não confirma ações sozinho. Nunca gere vídeo, VideoEmbed, iframe, credencial, dado pessoal ou link legado.',
        'Use somente ProductAction do catálogo confiável no contexto, com id, label, route e target exatos. Não invente ação, rota nem target.',
        'Em cada artigo preencha assistantQuestion com uma pergunta canônica, assistantOverview com orientação curta e útil a iniciante, assistantInitialSteps com 1 a 3 passos concretos presentes no body e assistantSuggestions com 1 a 3 próximas perguntas ou ações distintas. Não duplique passos.',
        'Se houver conflito entre fontes ou faltar nome de botão, formato aceito, permissão ou resultado esperado, use status=needs_information, liste as perguntas e deixe articles vazio.',
        'Cada body precisa ter pelo menos 60 palavras, Markdown simples e linguagem concreta. FAQ responde rapidamente; tutorial ensina do início ao resultado final.',
      ].join(' '),
    },
    { role: 'user', content: redactSensitiveData(`${requestText(request, existing, productContext)}\n\nPlano aprovado:\n${JSON.stringify(plan)}`) },
  ], options));
  const parsed = parseJson(response);
  if (parsed.status !== 'ready') return { ...parsed, articles: [], existing, model: response.model };
  const articles = parsed.articles.map((article) => ({
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
    return {
      status: 'needs_information',
      summary: 'A IA gerou conteúdo que não passou pela validação editorial.',
      questions: invalid.flatMap(({ path, issues }) => issues.map((issue) => `${path}: ${issue}`)),
      articles: [], existing, model: response.model,
    };
  }
  return { ...parsed, articles, existing, model: response.model };
}
