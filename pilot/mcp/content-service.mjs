import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, normalize, relative } from 'node:path';

const SOURCES = new Set(['produto', 'suporte', 'api']);
const CONTENT_TYPES = new Set(['faq', 'tutorial', 'guia', 'referencia']);
const SAFE_PATH = /^(docs|api|blog)\/[a-z0-9][a-z0-9/-]*$/;
const SECRET_PATTERNS = [
  /Authorization:\s*Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}/i,
  /AIza[0-9A-Za-z_-]{30,}/,
];

function escapeYaml(value) {
  return JSON.stringify(value.replaceAll('\r', '').trim());
}

function safeContentPath(root, contentPath) {
  if (!SAFE_PATH.test(contentPath) || contentPath.includes('..') || contentPath.endsWith('/')) {
    throw new Error('path deve começar com docs/, api/ ou blog/ e usar apenas slug seguro');
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
  if (/!\[\]\(/.test(article.body ?? '')) issues.push('imagens precisam de texto alternativo');
  if (/ihelpchat\.github\.io\/ihelp-docs/i.test(article.body ?? '')) issues.push('links legados não são permitidos');
  if (/^## Tutorial Guiado$/m.test(article.body ?? '')) issues.push('use um Tango público no campo tangoUrl em vez de rodapé genérico');
  if (/^#{2,6}\s+\*\*/m.test(article.body ?? '')) issues.push('headings não devem usar negrito redundante');
  if (SECRET_PATTERNS.some((pattern) => pattern.test(`${article.body ?? ''}\n${article.description ?? ''}`))) issues.push('possível credencial detectada');
  if (article.tangoUrl && !/^https:\/\/app\.tango\.us\/app\/(?:embed|workflow)\/[A-Za-z0-9-]+\/?$/.test(article.tangoUrl)) {
    issues.push('tangoUrl precisa ser uma URL oficial de embed ou workflow do Tango');
  }
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
  return `---\ntitle: ${escapeYaml(article.title)}\ndescription: ${escapeYaml(article.description)}\nsource: ${article.source}\ncontentType: ${article.contentType}\n---\n\n${article.body.trim()}${tutorial}\n`;
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

async function githubRequest(path, init = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN não configurado');
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
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function createPullRequest(article, rendered) {
  const repository = process.env.GITHUB_REPOSITORY ?? 'ihelpchat/ihelp-docs';
  const base = process.env.GITHUB_BASE_BRANCH ?? 'main';
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY inválido');
  const ref = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const slug = basename(article.path);
  const branch = `docs/ia-${slug}-${Date.now()}`;
  await githubRequest(`/repos/${owner}/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  const filePath = `pilot/content/docs/${article.path}.mdx`;
  await githubRequest(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `docs: adiciona ${article.title}`, content: Buffer.from(rendered).toString('base64'), branch }),
  });
  const pull = await githubRequest(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `docs: ${article.title}`,
      head: branch,
      base,
      body: 'Conteúdo enviado pelo MCP de documentação. Revise precisão, permissões, privacidade e links antes do merge.',
    }),
  });
  return { status: 'pull_request', url: pull.html_url, branch, filePath };
}

export async function submitArticle(root, article, mode = 'draft') {
  const rendered = renderArticle(article);
  safeContentPath(root, article.path);
  if (mode === 'pull_request') return createPullRequest(article, rendered);
  if (mode !== 'draft') throw new Error('mode deve ser draft ou pull_request');

  const draftRoot = join(root, '.drafts');
  const target = normalize(join(draftRoot, `${article.path}.mdx`));
  if (!target.startsWith(`${normalize(draftRoot)}/`)) throw new Error('path de draft inválido');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, rendered, { flag: 'wx' });
  return { status: 'draft', path: relative(root, target) };
}
