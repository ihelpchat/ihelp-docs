import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, normalize, relative } from 'node:path';
import { containsSensitiveData, redactSensitiveData, sensitiveKinds } from './sensitive-data.mjs';
import { isCatalogAction } from './product-actions.mjs';
import { conversationalIssues } from './conversational-contract.mjs';
import { stringify } from 'yaml';

const SOURCES = new Set(['produto', 'suporte', 'api']);
const CONTENT_TYPES = new Set(['faq', 'tutorial', 'guia', 'referencia']);
const SAFE_PATH = /^(docs|api|blog|tutoriais)\/[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;
const SAFE_ACTOR = /^(?:user|service):[a-z0-9][a-z0-9_-]{2,63}$/;
const SAFE_ACTION_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SAFE_PRODUCT_ROUTE = /^\/(?!\/)[a-z0-9/_-]*$/;
const SAFE_TARGET = /^[a-z][a-z0-9-]{2,63}$/;
export const isSafeRequestedBy = (value) => typeof value === 'string' && SAFE_ACTOR.test(value);
export class SubmitArticleError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

function publicSubmitError(error) {
  if (error instanceof SubmitArticleError) return error;
  if (error?.code === 'EEXIST') return new SubmitArticleError('DRAFT_EXISTS', 'Draft já existe');
  return new SubmitArticleError('SUBMIT_FAILED', 'Não foi possível enviar o artigo');
}
function escapeYaml(value) {
  return JSON.stringify(value.replaceAll('\r', '').trim());
}

function publicArticleText(article) {
  const fields = [article.path, article.title, article.description, article.source, article.contentType, article.body, article.tangoUrl, article.assistantQuestion, article.assistantOverview, ...(Array.isArray(article.assistantSuggestions) ? article.assistantSuggestions : [])];
  fields.push(...Object.entries(article).filter(([key]) => !['body', 'productActions'].includes(key)).map(([, value]) => value).filter((value) => typeof value === 'string'));
  for (const action of Array.isArray(article.productActions) ? article.productActions : []) {
    fields.push(action?.id, action?.label, action?.route, action?.target);
  }
  return fields.filter((value) => typeof value === 'string').join('\n');
}

function rejectSensitive(value) {
  if (!containsSensitiveData(value)) return;
  const kinds = sensitiveKinds(value);
  if (kinds.credential) throw new SubmitArticleError('CREDENTIAL', 'Artigo contém possível credencial');
  if (kinds.personal) throw new SubmitArticleError('PRIVATE_DATA', 'Artigo contém possível dado pessoal');
}

function safeContentPath(root, contentPath) {
  if (!SAFE_PATH.test(contentPath) || contentPath.includes('..') || contentPath.endsWith('/')) {
    throw new Error('path deve começar com docs/, tutoriais/, api/ ou blog/ e usar apenas slug seguro');
  }
  const target = normalize(join(root, 'content/docs', `${contentPath}.mdx`));
  const base = normalize(join(root, 'content/docs'));
  if (!target.startsWith(`${base}/`)) throw new Error('path fora da base de conteúdo');
  return target;
}

export function validateArticle(article) {
  const issues = [];
  if (!article.title || article.title.trim().length < 4) issues.push('title precisa ter ao menos 4 caracteres');
  if (!article.description || article.description.trim().length < 40) issues.push('description precisa ter ao menos 40 caracteres');
  if (!SOURCES.has(article.source)) issues.push('source inválido');
  if (!CONTENT_TYPES.has(article.contentType)) issues.push('contentType inválido');
  if (!article.path || !SAFE_PATH.test(article.path) || article.path.includes('..')) issues.push('path inválido');
  if (!article.body || article.body.trim().split(/\s+/).filter(Boolean).length < 60) issues.push('body precisa ter ao menos 60 palavras');
  if (/<script\b/i.test(article.body ?? '')) issues.push('scripts não são permitidos');
  if (/<iframe\b/i.test(article.body ?? '')) issues.push('iframes devem ser enviados pelo campo tangoUrl');
  if (/<(?:video|VideoEmbed)\b|https?:\/\/\S+\.(?:mp4|webm)\b/i.test(article.body ?? '')) issues.push('vídeo não faz parte do pacote editorial');
  if (/!\[\]\(/.test(article.body ?? '')) issues.push('imagens precisam de texto alternativo');
  if (/ihelpchat\.github\.io\/ihelp-docs/i.test(article.body ?? '')) issues.push('links legados não são permitidos');
  if (/^## Tutorial Guiado$/m.test(article.body ?? '')) issues.push('use um Tango público no campo tangoUrl em vez de rodapé genérico');
  if (/^#{2,6}\s+\*\*/m.test(article.body ?? '')) issues.push('headings não devem usar negrito redundante');
  const publicText = publicArticleText(article);
  const sensitive = sensitiveKinds(publicText);
  if (sensitive.credential) issues.push('possível credencial detectada');
  if (sensitive.personal) issues.push('possível dado pessoal detectado');
  if (article.tangoUrl && !/^https:\/\/app\.tango\.us\/app\/(?:embed|workflow)\/[A-Za-z0-9-]+\/?$/.test(article.tangoUrl)) {
    issues.push('tangoUrl precisa ser uma URL oficial de embed ou workflow do Tango');
  }
  if (article.productActions !== undefined && !Array.isArray(article.productActions)) issues.push('productActions precisa ser uma lista');
  const actionIds = new Set();
  for (const action of Array.isArray(article.productActions) ? article.productActions : []) {
    if (!action || !SAFE_ACTION_ID.test(action.id ?? '')) issues.push('productActions.id inválido');
    else if (actionIds.has(action.id)) issues.push(`productActions.id duplicado: ${action.id}`);
    else actionIds.add(action.id);
    if (typeof action?.label !== 'string' || action.label.trim().length < 3 || action.label.trim().length > 80) issues.push('productActions.label inválido');
    if (!SAFE_PRODUCT_ROUTE.test(action?.route ?? '')) issues.push('productActions.route inválida');
    if (action?.target && !SAFE_TARGET.test(action.target)) issues.push('productActions.target inválido');
    if (!isCatalogAction(action)) issues.push('productActions deve corresponder exatamente ao catálogo confiável');
  }
  if ((article.productActions?.length ?? 0) > 12) issues.push('productActions aceita no máximo 12 ações');
  issues.push(...conversationalIssues(article));
  return { valid: issues.length === 0, issues };
}

export function renderArticle(article) {
  const validation = validateArticle(article);
  if (!validation.valid) throw new Error(validation.issues.join('; '));
  const tangoId = article.tangoUrl?.split('/').pop()?.split('?')[0].replaceAll('-', '');
  const tangoSlug = article.title.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const publicTangoUrl = article.tangoUrl?.includes('/workflow/')
    ? article.tangoUrl
    : tangoId ? `https://app.tango.us/app/workflow/${tangoSlug}-${tangoId}` : undefined;
  const tutorial = article.tangoUrl
    ? `\n\n<TutorialCard title=${escapeYaml(article.title)} url=${escapeYaml(publicTangoUrl)} description=${escapeYaml(article.description)} />`
    : '';
  const actions = (article.productActions ?? []).map((action) =>
    `<ProductAction id=${escapeYaml(action.id)} label=${escapeYaml(action.label)} route=${escapeYaml(action.route)}${action.target ? ` target=${escapeYaml(action.target)}` : ''} />`
  ).join('\n');
  const actionBlock = actions ? `\n\n${actions}` : '';
  const serializedSuggestions = article.assistantSuggestions?.some((item) => item.includes('|'))
    ? JSON.stringify(article.assistantSuggestions)
    : escapeYaml(article.assistantSuggestions?.join(' | ') ?? '');
  const reserved = new Set(['path', 'body', 'tangoUrl', 'productActions']);
  const metadata = Object.fromEntries(Object.entries(article).filter(([key, value]) => !reserved.has(key) && value !== undefined));
  if (metadata.assistantSuggestions) metadata.assistantSuggestions = serializedSuggestions.startsWith('[') ? serializedSuggestions : JSON.parse(serializedSuggestions);
  const embeddedAction = /<ProductAction\b[^>]*\/>/g;
  const body = article.productActions?.length ? article.body.replace(embeddedAction, '').trim() : article.body.trim();
  return `---\n${stringify(metadata, { lineWidth: 0 })}---\n\n${body}${actionBlock}${tutorial}\n`;
}

async function walk(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.name.endsWith('.mdx')) output.push(path);
  }
  return output;
}

function frontmatterValue(raw, key) {
  return raw.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?$`, 'm'))?.[1]?.replace(/["']$/, '') ?? '';
}

export async function searchContent(root, query, limit = 8) {
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  if (normalizedQuery.length < 2) throw new Error('query precisa ter ao menos 2 caracteres');
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const contentBase = join(root, 'content/docs');
  const matches = [];
  for (const file of await walk(contentBase)) {
    const raw = await readFile(file, 'utf8');
    const normalized = raw.toLocaleLowerCase('pt-BR');
    if (!terms.every((term) => normalized.includes(term))) continue;
    const title = frontmatterValue(raw, 'title');
    const normalizedTitle = title.toLocaleLowerCase('pt-BR');
    const phraseIndex = normalized.indexOf(normalizedQuery);
    const index = phraseIndex >= 0 ? phraseIndex : normalized.indexOf(terms[0]);
    const score = (phraseIndex >= 0 ? 100 : 0) + terms.reduce((total, term) => total + (normalizedTitle.includes(term) ? 10 : 1), 0);
    matches.push({
      path: `/${relative(contentBase, file).replace(/\/index\.mdx$/, '').replace(/\.mdx$/, '')}`,
      title,
      description: frontmatterValue(raw, 'description'),
      snippet: raw.slice(Math.max(0, index - 70), index + normalizedQuery.length + 130).replace(/\s+/g, ' ').trim(),
      score,
    });
  }
  return matches
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ path, title, description, snippet }) => ({ path, title, description, snippet }));
}

export async function getInventory(root) {
  const matrix = JSON.parse(await readFile(join(root, 'architecture/coverage-matrix.json'), 'utf8'));
  const counts = { complete: 0, partial: 0, missing: 0 };
  for (const row of matrix) counts[row.coverage] += 1;
  return {
    modules: matrix.length,
    counts,
    gaps: matrix.filter((row) => row.coverage !== 'complete').map(({ module, coverage, priority }) => ({ module, coverage, priority })),
  };
}

async function githubRequest(path, init = {}, allowNotFound = false) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new SubmitArticleError('GITHUB_NOT_CONFIGURED', 'GITHUB_TOKEN não configurado');
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 'desconhecido';
    throw new SubmitArticleError('GITHUB_HTTP_ERROR', `GitHub API ${status} rejeitou operação`);
  }
  return response.json();
}

async function createPullRequest(article, rendered, actor, beforePull) {
  const repository = process.env.GITHUB_REPOSITORY ?? 'ihelpchat/ihelp-docs';
  const base = process.env.GITHUB_BASE_BRANCH ?? 'main';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY inválido');
  const submittedAt = new Date().toISOString();
  const title = `docs: ${article.title}`;
  const body = `Conteúdo enviado pelo MCP de documentação. Revise precisão, permissões, privacidade e links antes do merge.\n\nAudit MCP: actor=${actor}; at=${submittedAt}; operation=docs_submit_article; target=${article.path}; mode=pull_request.`;
  rejectSensitive(`${title}\n${body}`);
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const slug = basename(article.path);
  const branch = `docs/ia-${slug}-${Date.now()}`;
  await githubRequest(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  const filePath = `pilot/content/docs/${article.path}.mdx`;
  await githubRequest(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `docs: adiciona ${article.title}`, content: Buffer.from(rendered).toString('base64'), branch }),
  });
  await beforePull(branch);
  const pull = await githubRequest(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      head: branch,
      base,
      body,
    }),
  });
  return { status: 'pull_request', url: pull.html_url, branch, filePath };
}

async function appendAudit(root, actor, mode, target, result, reference) {
  const directory = join(root, '.audit');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) throw new Error('diretório de audit inseguro');
  const file = await open(join(directory, 'docs-submissions.jsonl'), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw new Error('arquivo de audit inseguro');
    const line = `${JSON.stringify({ at: new Date().toISOString(), actor, operation: 'docs_submit_article', mode, target: typeof target === 'string' ? redactSensitiveData(target) : target, result, ...(reference ? { reference } : {}) })}\n`;
    const { bytesWritten } = await file.write(line);
    if (bytesWritten !== Buffer.byteLength(line)) throw new Error('registro de audit incompleto');
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function auditOperation(root, { actor, operation, mode = null, target = null, result, reference }) {
  if (!isSafeRequestedBy(actor)) throw new SubmitArticleError('INVALID_REQUESTED_BY', 'requestedBy deve ser um ID opaco user: ou service: sem dados pessoais');
  const directory = join(root, '.audit');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) throw new Error('diretório de audit inseguro');
  const file = await open(join(directory, 'docs-submissions.jsonl'), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) throw new Error('arquivo de audit inseguro');
    const safeTarget = Array.isArray(target) ? target.map(redactSensitiveData) : typeof target === 'string' ? redactSensitiveData(target) : target;
    const line = `${JSON.stringify({ at: new Date().toISOString(), actor, operation, mode, target: safeTarget, result, ...(reference ? { reference } : {}) })}\n`;
    await file.writeFile(line);
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function submitArticle(root, article, mode = 'draft', requestedBy) {
  try {
    return await submitArticleAudited(root, article, mode, requestedBy);
  } catch (error) {
    throw publicSubmitError(error);
  }
}

async function submitArticleAudited(root, article, mode, requestedBy) {
  const actor = isSafeRequestedBy(requestedBy) ? requestedBy : null;
  const target = typeof article.path === 'string' && SAFE_PATH.test(article.path) && !article.path.endsWith('/') ? redactSensitiveData(article.path) : null;
  const safeMode = mode === 'draft' || mode === 'pull_request' ? mode : null;
  await appendAudit(root, actor, safeMode, target, 'attempt');
  let result;
  try {
    if (!actor) throw new SubmitArticleError('INVALID_REQUESTED_BY', 'requestedBy deve ser um ID opaco user: ou service: sem dados pessoais');
    result = await submitValidatedArticle(root, article, mode, actor, (branch) => appendAudit(root, actor, safeMode, target, 'external_request', branch));
  } catch (error) {
    await appendAudit(root, actor, safeMode, target, 'failure');
    throw error;
  }
  try {
    await appendAudit(root, actor, safeMode, target, 'success', result.branch);
  } catch (error) {
    if (mode === 'pull_request') {
      const safeUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(result.url) ? result.url : '(URL indisponível)';
      throw new SubmitArticleError('PR_CREATED_AUDIT_FAILED', `pull_request criado em ${safeUrl}; audit final indisponível`, { cause: error });
    }
    throw error;
  }
  return result;
}

async function createDraft(root, article, rendered) {
  const draftRoot = join(root, '.drafts');
  const parts = article.path.split('/');
  let directory = draftRoot;
  for (const part of ['', ...parts.slice(0, -1)]) {
    if (part) directory = join(directory, part);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || (stat.mode & 0o022) !== 0) throw new SubmitArticleError('UNSAFE_DRAFT_PATH', 'Diretório de draft inseguro');
  }
  const canonicalRoot = await realpath(draftRoot);
  const canonicalParent = await realpath(directory);
  if (!canonicalParent.startsWith(`${canonicalRoot}/`)) throw new SubmitArticleError('UNSAFE_DRAFT_PATH', 'Path de draft fora da base');
  const target = join(directory, `${parts.at(-1)}.mdx`);
  const file = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(rendered);
    await file.sync();
  } finally {
    await file.close();
  }
  return { status: 'draft', path: relative(root, target) };
}

async function submitValidatedArticle(root, article, mode, actor, beforePull) {
  const [{ rendered }] = safeArticleList([article]);
  safeContentPath(root, article.path);
  if (mode === 'pull_request') return createPullRequest(article, rendered, actor, beforePull);
  if (mode !== 'draft') throw new Error('mode deve ser draft ou pull_request');
  return createDraft(root, article, rendered);
}

function safeArticleList(articles, deletes = []) {
  if (!Array.isArray(articles) || !Array.isArray(deletes) || articles.length + deletes.length < 1 || articles.length + deletes.length > 8) throw new SubmitArticleError('INVALID_PACKAGE', 'O pacote precisa ter entre 1 e 8 operações');
  const paths = new Set();
  const upserts = articles.map((article) => {
    rejectSensitive(publicArticleText(article));
    if (paths.has(article.path)) throw new SubmitArticleError('INVALID_PACKAGE', `Path duplicado no pacote: ${article.path}`);
    paths.add(article.path);
    safeContentPath(process.cwd(), article.path);
    const reserved = new Set(['path', 'body', 'productActions', 'tangoUrl']);
    for (const [key, value] of Object.entries(article)) {
      if (reserved.has(key)) continue;
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean' && !(Array.isArray(value) && value.every((item) => typeof item === 'string')))) {
        throw new SubmitArticleError('INVALID_PACKAGE', `Metadado inválido: ${key}`);
      }
    }
    const inline = [...article.body.matchAll(/<ProductAction\b([^>]*?)\/>/g)].map((match) => {
      const attributes = [...match[1].matchAll(/\b(id|label|route|target)="([^"]*)"/g)];
      if (match[1].replace(/\b(id|label|route|target)="[^"]*"/g, '').trim()) throw new SubmitArticleError('INVALID_PACKAGE', 'ProductAction contém atributos desconhecidos');
      const action = Object.fromEntries(attributes.map((entry) => [entry[1], entry[2]]));
      if (!isCatalogAction(action)) throw new SubmitArticleError('INVALID_PACKAGE', 'ProductAction no body fora do catálogo confiável');
      return action;
    });
    if ((article.body.match(/<ProductAction\b/g) ?? []).length !== inline.length) throw new SubmitArticleError('INVALID_PACKAGE', 'ProductAction inválido no body');
    if (new Set(inline.map((action) => action.id)).size !== inline.length) throw new SubmitArticleError('INVALID_PACKAGE', 'ProductAction duplicado no body');
    for (const action of article.productActions ?? []) {
      const embedded = inline.find((candidate) => candidate.id === action.id);
      if (embedded && JSON.stringify(embedded) !== JSON.stringify(action)) throw new SubmitArticleError('INVALID_PACKAGE', 'ProductAction do body difere do campo productActions');
    }
    if (article.productActions?.length && inline.some((action) => !article.productActions.some((candidate) => candidate.id === action.id))) {
      throw new SubmitArticleError('INVALID_PACKAGE', 'ProductAction do body ausente de productActions');
    }
    return { article, rendered: renderArticle(article) };
  });
  for (const path of deletes) {
    rejectSensitive(path);
    safeContentPath(process.cwd(), path);
    if (paths.has(path)) throw new SubmitArticleError('INVALID_PACKAGE', `Path duplicado no pacote: ${path}`);
    paths.add(path);
  }
  return upserts;
}

async function createPackagePullRequest(items, deletes, actor, beforePull) {
  const repository = process.env.GITHUB_REPOSITORY ?? 'ihelpchat/ihelp-docs';
  const base = process.env.GITHUB_BASE_BRANCH ?? 'main';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY inválido');
  const submittedAt = new Date().toISOString();
  const targets = [...items.map(({ article }) => article.path), ...deletes.map((path) => `-${path}`)].join(', ');
  const title = items.length ? `docs: pacote ${items[0].article.title}` : `docs: remove ${deletes.length === 1 ? deletes[0] : `${deletes.length} artigos`}`;
  const body = `Pacote criado pelo MCP da documentação. Revise precisão, navegação, permissões e links antes do merge.\n\nArtigos: ${targets}\n\nAudit MCP: actor=${actor}; at=${submittedAt}; operation=docs_submit_package; mode=pull_request.`;
  rejectSensitive(`${title}\n${body}`);
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const contentFile = (path) => `pilot/content/docs/${path}.mdx`;
  const fileAt = (path, revision) => `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(revision)}`;
  const previousByPath = new Map();
  for (const path of [...items.map(({ article }) => article.path), ...deletes]) {
    const previous = await githubRequest(fileAt(contentFile(path), ref.object.sha), {}, true);
    if (deletes.includes(path) && !previous) throw new SubmitArticleError('ARTICLE_NOT_FOUND', `Artigo não encontrado: ${path}`);
    previousByPath.set(path, previous);
  }
  const branch = `docs/ia-pacote-${Date.now()}`;
  await githubRequest(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  const affectedDirectories = new Map();
  const remember = (path, operation) => {
    const parts = path.split('/');
    for (let depth = parts.length - 1; depth >= 1; depth -= 1) {
      if (operation === 'delete' && depth !== parts.length - 1) break;
      const directory = parts.slice(0, depth).join('/');
      if (!affectedDirectories.has(directory)) affectedDirectories.set(directory, []);
      affectedDirectories.get(directory).push({ slug: parts[depth], operation: depth === parts.length - 1 ? operation : 'upsert' });
    }
  };
  for (const { article, rendered } of items) {
    const filePath = contentFile(article.path);
    const previous = previousByPath.get(article.path);
    await githubRequest(`/repos/${owner}/${repo}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({ message: `docs: atualiza ${article.title}`, content: Buffer.from(rendered).toString('base64'), branch, ...(previous ? { sha: previous.sha } : {}) }),
    });
    remember(article.path, 'upsert');
  }
  for (const path of deletes) {
    const filePath = contentFile(path);
    const previous = previousByPath.get(path);
    await githubRequest(`/repos/${owner}/${repo}/contents/${filePath}`, {
      method: 'DELETE', body: JSON.stringify({ message: `docs: remove ${path}`, sha: previous.sha, branch }),
    });
    remember(path, 'delete');
  }
  for (const [directory, changes] of affectedDirectories) {
    const filePath = `pilot/content/docs/${directory}/meta.json`;
    const previous = await githubRequest(fileAt(filePath, branch), {}, true);
    let meta;
    try {
      meta = previous ? JSON.parse(Buffer.from(previous.content.replaceAll('\n', ''), 'base64').toString('utf8')) : { pages: [] };
    } catch {
      throw new SubmitArticleError('INVALID_META', `meta.json inválido em ${directory}`);
    }
    if (!Array.isArray(meta.pages)) throw new SubmitArticleError('INVALID_META', `meta.json sem pages em ${directory}`);
    const pages = [...meta.pages];
    for (const { slug, operation } of changes) {
      const index = pages.indexOf(slug);
      if (operation === 'delete' && index >= 0) pages.splice(index, 1);
      if (operation === 'upsert' && index < 0) pages.push(slug);
    }
    if (JSON.stringify(pages) !== JSON.stringify(meta.pages)) {
      meta.pages = pages;
      await githubRequest(`/repos/${owner}/${repo}/contents/${filePath}`, {
        method: 'PUT', body: JSON.stringify({ message: `docs: atualiza navegação ${directory}`, content: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`).toString('base64'), branch, ...(previous ? { sha: previous.sha } : {}) }),
      });
    }
  }
  await beforePull(branch);
  const pull = await githubRequest(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title,
      head: branch,
      base,
      body,
    }),
  });
  return { status: 'pull_request', url: pull.html_url, branch, articles: items.map(({ article }) => article.path), deleted: deletes };
}

export async function submitContentPackage(root, articles, mode = 'draft', requestedBy, deletes = []) {
  if (!isSafeRequestedBy(requestedBy)) throw new SubmitArticleError('INVALID_REQUESTED_BY', 'requestedBy deve ser um ID opaco user: ou service: sem dados pessoais');
  const actor = isSafeRequestedBy(requestedBy) ? requestedBy : null;
  const targets = [...(Array.isArray(articles) ? articles.map((article) => article?.path) : []), ...(Array.isArray(deletes) ? deletes : [])].filter((path) => typeof path === 'string' && SAFE_PATH.test(path)).map(redactSensitiveData);
  const operation = !articles?.length && deletes?.length ? 'docs_delete_article' : 'docs_submit_package';
  const auditMode = ['draft', 'pull_request'].includes(mode) ? mode : null;
  if (mode === 'dry_run') {
    safeArticleList(articles, deletes);
    return { status: 'dry_run', articles: articles.map(({ path }) => path), deleted: deletes };
  }
  await auditOperation(root, { actor, operation, mode: auditMode, target: targets, result: 'attempt' });
  try {
    const items = safeArticleList(articles, deletes);
    let result;
    if (mode === 'draft') {
      const drafts = [];
      for (const { article, rendered } of items) drafts.push(await createDraft(root, article, rendered));
      for (const path of deletes) {
        const manifest = { operation: 'delete', path };
        drafts.push(await createDraft(root, { path: `docs/remocoes/${path.replaceAll('/', '-')}` }, `${JSON.stringify(manifest, null, 2)}\n`));
      }
      result = { status: 'draft', articles: drafts };
    } else if (mode === 'pull_request') {
      result = await createPackagePullRequest(items, deletes, actor, (branch) => auditOperation(root, { actor, operation, mode: auditMode, target: targets, result: 'external_request', reference: branch }));
    } else {
      throw new SubmitArticleError('INVALID_MODE', 'mode deve ser draft ou pull_request');
    }
    try {
      await auditOperation(root, { actor, operation, mode: auditMode, target: targets, result: 'success', reference: result.branch });
    } catch (error) {
      if (mode === 'pull_request') {
        const safeUrl = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(result.url) ? result.url : '(URL indisponível)';
        throw new SubmitArticleError('PR_CREATED_AUDIT_FAILED', `pull_request criado em ${safeUrl}; audit final indisponível`, { cause: error });
      }
      throw error;
    }
    return result;
  } catch (error) {
    if (error instanceof SubmitArticleError && error.code === 'PR_CREATED_AUDIT_FAILED') throw error;
    if (actor) await auditOperation(root, { actor, operation, mode: auditMode, target: targets, result: 'failure' });
    throw publicSubmitError(error);
  }
}

export async function deleteArticle(root, contentPath, mode = 'draft', requestedBy) {
  if (!isSafeRequestedBy(requestedBy)) throw new SubmitArticleError('INVALID_REQUESTED_BY', 'requestedBy deve ser um ID opaco user: ou service: sem dados pessoais');
  rejectSensitive(contentPath);
  safeContentPath(root, contentPath);
  if (mode === 'pull_request') return submitContentPackage(root, [], mode, requestedBy, [contentPath]);
  await auditOperation(root, { actor: requestedBy, operation: 'docs_delete_article', mode, target: contentPath, result: 'attempt' });
  try {
    if (mode === 'draft') {
      const manifest = { path: contentPath, operation: 'delete' };
      const article = {
        path: `docs/remocoes/${contentPath.replaceAll('/', '-')}`,
        title: `Remover ${basename(contentPath)}`,
        description: `Solicitação versionada para remover o conteúdo ${contentPath} da documentação do iHelp.`,
        source: 'produto', contentType: 'guia',
        body: `Esta solicitação registra a remoção do artigo ${contentPath}. Antes de aplicar, confira links internos, navegação e conteúdos que dependem dessa página. A remoção deve acontecer em pull request para preservar o histórico e permitir revisão. Depois da alteração, execute a auditoria completa da documentação e confirme que nenhuma rota interna ficou quebrada. O registro existe apenas para revisão e não remove conteúdo automaticamente neste modo.`,
      };
      const draft = await createDraft(root, article, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = { status: 'draft', ...draft };
      await auditOperation(root, { actor: requestedBy, operation: 'docs_delete_article', mode, target: contentPath, result: 'success' });
      return result;
    }
    throw new SubmitArticleError('DELETE_REQUIRES_REVIEW', 'A remoção remota deve ser aplicada por pull request após validar dependências');
  } catch (error) {
    await auditOperation(root, { actor: requestedBy, operation: 'docs_delete_article', mode, target: contentPath, result: 'failure' });
    throw publicSubmitError(error);
  }
}
