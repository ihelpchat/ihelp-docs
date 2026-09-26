const treeCache = new Map();
import { readFile, readdir } from 'node:fs/promises';
import { redactSensitiveData } from './sensitive-data.mjs';
import { join } from 'node:path';
import { searchLocalProductContext } from './local-product-context.mjs';
import { envCompatibility, githubReadToken } from './env-compat.mjs';
import { parse } from 'yaml';
const CACHE_MS = 5 * 60_000;
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|cs)$/;
const PINNED_PATHS = new Set([
  'src/components/core/components/Router/utils/pagesData.tsx',
  'src/components/ui/components/NavBar/index.tsx',
]);
const ALIASES = {
  atendimento: ['attendance', 'chat'],
  contatos: ['contact', 'contacts'],
  contato: ['contact', 'contacts'],
  tarefas: ['task', 'tasks'],
  tarefa: ['task', 'tasks'],
  campanhas: ['campaign', 'campaigns'],
  campanha: ['campaign', 'campaigns'],
  configuracoes: ['configuration', 'settings'],
  usuarios: ['user', 'users'],
  usuario: ['user', 'users'],
  relatorios: ['report', 'reports'],
  relatorio: ['report', 'reports'],
  importar: ['import'],
  exportar: ['export'],
};

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

function termsOf(topic, module) {
  const base = `${topic} ${module}`.split(/[^\p{L}\p{N}]+/u).map(normalize).filter((term) => term.length > 2);
  return [...new Set(base.flatMap((term) => [term, ...(ALIASES[term] ?? [])]))];
}

async function githubJson(path, options) {
  const response = await options.fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${options.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} rejeitou consulta do produto`);
  return response.json();
}

async function treeOf(options) {
  const key = `${options.repository}@${options.ref}`;
  const cached = treeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.paths;
  const data = await githubJson(`/repos/${options.repository}/git/trees/${encodeURIComponent(options.ref)}?recursive=1`, options);
  const paths = (data.tree ?? [])
    .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string' && SOURCE_FILE.test(entry.path) && !/(?:^|\/)(?:node_modules|bin|obj|dist)\//.test(entry.path))
    .map((entry) => entry.path);
  treeCache.set(key, { at: Date.now(), paths });
  return paths;
}

function pathScore(path, terms) {
  const value = normalize(path);
  return terms.reduce((score, term) => score + (value.includes(term) ? 8 : 0), PINNED_PATHS.has(path) ? 20 : 0);
}

function excerptOf(content, terms) {
  const lines = content.split('\n');
  const indexes = [];
  lines.forEach((line, index) => {
    const value = normalize(line);
    if (terms.some((term) => value.includes(term))) indexes.push(index);
  });
  if (!indexes.length) return redactSensitiveData(lines.slice(0, 80).join('\n').slice(0, 6_000));
  const selected = new Set();
  for (const index of indexes.slice(0, 20)) for (let line = Math.max(0, index - 3); line <= Math.min(lines.length - 1, index + 5); line += 1) selected.add(line);
  return redactSensitiveData([...selected].toSorted((left, right) => left - right).map((index) => `${index + 1}: ${lines[index]}`).join('\n').slice(0, 8_000));
}

export async function searchProductContext(topic, module, provided = {}) {
  const options = {
    fetch: provided.fetch ?? globalThis.fetch,
    token: provided.token ?? githubReadToken(),
    repository: provided.repository ?? process.env.PRODUCT_GITHUB_REPOSITORY ?? 'ihelpchat/front-react',
    ref: provided.ref ?? process.env.PRODUCT_GITHUB_REF ?? 'master',
  };
  if (!options.token) return { available: false, repository: options.repository, ref: options.ref, matches: [], reason: 'GITHUB_READ_TOKEN não configurado' };
  const terms = termsOf(topic, module);
  const paths = await treeOf(options);
  const candidates = paths
    .map((path) => ({ path, score: pathScore(path, terms) }))
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, 16);
  const matches = [];
  for (const candidate of candidates) {
    const data = await githubJson(`/repos/${options.repository}/contents/${encodeURIComponent(candidate.path).replaceAll('%2F', '/')}?ref=${encodeURIComponent(options.ref)}`, options);
    if (data.encoding !== 'base64' || typeof data.content !== 'string') continue;
    const content = Buffer.from(data.content.replaceAll('\n', ''), 'base64').toString('utf8');
    const textScore = terms.reduce((score, term) => score + (normalize(content).includes(term) ? 3 : 0), candidate.score);
    matches.push({ path: redactSensitiveData(candidate.path), score: textScore, excerpt: excerptOf(content, terms) });
  }
  return {
    available: true,
    repository: options.repository,
    ref: options.ref,
    matches: matches.toSorted((left, right) => right.score - left.score).slice(0, 8).map(({ path, excerpt }) => ({ path, excerpt })),
  };
}

export async function getIhelpContext(root, topic, module, provided = {}) {
  const local = provided.requireLocal === true || provided.repositoryIds !== undefined
    || (!provided.fetch && !provided.repositories && Boolean(process.env[envCompatibility.localCheckouts.frontend] || process.env[envCompatibility.localCheckouts.backend]));
  const token = provided.token ?? githubReadToken();
  const fetcher = provided.fetch ?? globalThis.fetch;
  const repositories = provided.repositories ?? [
    { repository: process.env.PRODUCT_GITHUB_REPOSITORY ?? 'ihelpchat/front-react', ref: process.env.PRODUCT_GITHUB_REF ?? 'master', role: 'Interface, rotas, permissões visíveis e textos de botões' },
    { repository: process.env.BACKEND_GITHUB_REPOSITORY ?? 'ihelpchat/olah-ihelp', ref: process.env.BACKEND_GITHUB_REF ?? 'master', role: 'Regras de negócio, APIs, permissões e validações' },
  ];
  const localResult = local ? await searchLocalProductContext(topic, module, { repositoryIds: provided.repositoryIds }) : null;
  const code = localResult?.code ?? [];
  if (!local) for (const source of repositories) {
    const result = await searchProductContext(topic, module, { fetch: fetcher, token, repository: source.repository, ref: source.ref }).catch((error) => ({ available: false, repository: source.repository, ref: source.ref, matches: [], reason: error.message }));
    code.push({ ...result, role: source.role });
  }
  const supportSignals = JSON.parse(await readFile(join(root, 'architecture/support-signals.json'), 'utf8'));
  const coverage = JSON.parse(await readFile(join(root, 'architecture/coverage-matrix.json'), 'utf8'));
  const terms = termsOf(topic, module);
  const relevantSupport = supportSignals.categories
    .map((item) => ({ ...item, score: terms.reduce((score, term) => score + (normalize(`${item.category} ${item.guidance}`).includes(term) ? 1 : 0), 0) }))
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ score: _score, ...item }) => item);
  const relevantCoverage = coverage.filter((item) => terms.some((term) => normalize(item.module).includes(term) || (ALIASES[normalize(item.module)] ?? []).includes(term)));
  let endpoints = [];
  let apiExamples = [];
  let contextCode = code;
  let nonPublicEndpoints = false;
  if (normalize(module) === 'api' || /\bendpoint\b|\/api\/v\d/iu.test(topic)) {
    endpoints = code.flatMap((source) => source.endpoints ?? []);
    const docsRoot = join(provided.publicReferenceRoot ?? root, 'content/docs/api');
    const pages = (await readdir(docsRoot, { recursive: true }).catch(() => []))
      .filter((path) => path.endsWith('.mdx'))
      .sort((left, right) => Number(normalize(right).includes(terms.find((term) => term !== 'api') ?? '\0')) - Number(normalize(left).includes(terms.find((term) => term !== 'api') ?? '\0')));
    const documented = new Set();
    for (const page of pages) {
      const raw = await readFile(join(docsRoot, page), 'utf8');
      const match = raw.match(/^---\n([\s\S]*?)\n---/u);
      if (!match) continue;
      const frontmatter = parse(match[1]);
      if (frontmatter?.source === 'api' && frontmatter?.method && frontmatter?.endpoint) {
        documented.add(`${frontmatter.method} ${String(frontmatter.endpoint).toLowerCase().replace(/\{[^}]+\}/gu, '{}')}`);
        apiExamples.push({ frontmatter: { source: frontmatter.source, contentType: frontmatter.contentType,
          method: frontmatter.method, endpoint: frontmatter.endpoint },
        sections: [...raw.matchAll(/^## (.+)$/gmu)].map((section) => section[1]) });
      }
    }
    const publicControllers = new Set(endpoints.filter((item) => /^\/api\/v2\//iu.test(item.route) &&
      documented.has(`${item.verb} ${item.route.replace(/^\/api\/v\d+/iu, '').toLowerCase().replace(/\{[^}]+\}/gu, '{}')}`))
      .map((item) => item.file));
    endpoints = endpoints.map((item) => ({ ...item,
      documented: /^\/api\/v2\//iu.test(item.route) && documented.has(`${item.verb} ${item.route.replace(/^\/api\/v\d+/iu, '').toLowerCase().replace(/\{[^}]+\}/gu, '{}')}`),
      explicit: (provided.explicitEndpoints ?? []).some((route) => route.toLowerCase() === item.route.toLowerCase()
        || route.toLowerCase() === item.route.replace(/^\/api\/v\d+/iu, '').toLowerCase()),
      public: publicControllers.has(item.file)
      || (provided.explicitEndpoints ?? []).some((route) => route.toLowerCase() === item.route.toLowerCase()
        || route.toLowerCase() === item.route.replace(/^\/api\/v\d+/iu, '').toLowerCase()) }));
    const privateFiles = new Set(endpoints.filter((item) => !item.public).map((item) => item.file));
    nonPublicEndpoints = privateFiles.size > 0;
    endpoints = endpoints.filter((item) => item.public);
    contextCode = code.map((source) => ({ ...source,
      endpoints: (source.endpoints ?? []).filter((item) => !privateFiles.has(item.file)),
      matches: source.matches.filter((match) => !privateFiles.has(match.path)),
    }));
    apiExamples = apiExamples.slice(0, 4);
  }
  return {
    code: contextCode,
    groundingRequired: local,
    support: {
      source: supportSignals.source,
      period: supportSignals.period,
      categories: relevantSupport,
      rules: supportSignals.rules,
    },
    coverage: relevantCoverage,
    endpoints,
    nonPublicEndpoints,
    apiExamples,
    matches: [...contextCode.flatMap((source) => source.matches.map((match) => ({ ...match, repository: source.repository, ref: source.ref, role: source.role }))),
      ...endpoints.filter((item) => item.documented || item.explicit).flatMap((item) => [item, ...item.parameters, ...item.responseFields]
        .map((fact) => ({ repository: 'ihelpchat/olah-ihelp', role: 'backend',
          path: fact.source.split(':')[0], line: Number(fact.source.split(':').at(-1)),
          sha: item.sha, ref: item.sha, excerpt: JSON.stringify(fact) })))],
    repository: code[0]?.repository ?? repositories[0].repository,
    ref: code[0]?.ref ?? repositories[0].ref,
  };
}
