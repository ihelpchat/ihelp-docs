import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath } from 'node:fs/promises';
import { canReadBackFile, readBackFile, safeRead, statBackFile } from './back-file-reader.mjs';
import { isAbsolute, join, relative, sep, dirname, parse } from 'node:path';
import { containsSensitiveData, redactSensitiveData } from './sensitive-data.mjs';
import { envCompatibility } from './env-compat.mjs';
import ts from 'typescript';
import uiSynonyms from './ui-synonyms.json' with { type: 'json' };
import coverageMatrix from '../architecture/coverage-matrix.json' with { type: 'json' };
import { readCsharpEndpoints, collectCsharpErrors } from '../lib/csharp-endpoints.mjs';
import { traceCsharpCalls } from '../lib/csharp-call-chain.mjs';
import { routeMatches } from './api-route-match.mjs';
import { extractScreenFacts, FRONT_ROUTER } from './front-screen-facts.mjs';

const run = promisify(execFile);
const SOURCE = /\.(?:ts|tsx|js|jsx|cs)$/iu;
const BLOCKED = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|node_modules|dist|build|out|bin|obj|logs?|backups?|coverage|migrations?|secrets?|credentials?|fixtures?|__tests__|tests?|public)(?:\/|$)/iu;
const BLOCKED_FILE = /(?:^|\/)(?:[^/]*(?:key|secret|token|credential|password|env|config)[^/]*|[^/]*\.(?:min|designer|generated|spec|test)|styles?)\.(?:ts|tsx|js|jsx|cs)$/iu;
const SHA = /^[a-f0-9]{40}$/u;
const MAX_LISTED = 10_000;
const MAX_SEARCH_FILES = 10_000;
const MAX_FILE_BYTES = 256_000;
const MAX_TOTAL_BYTES = 64_000_000;
const TIMEOUT_MS = 2_000;
const DEFAULT_DEADLINE_MS = 10_000;
const listedCache = new Map();
const eligibleCache = new Map();
const fileCache = new Map();
const controllerCache = new Map();
const SOURCES = Object.freeze({
  frontend: { repository: 'ihelpchat/front-react', role: 'frontend', env: envCompatibility.localCheckouts.frontend,
    folders: ['src/components', 'src/pages', 'src/features', 'src/routes'] },
  backend: { repository: 'ihelpchat/olah-ihelp', role: 'backend', env: envCompatibility.localCheckouts.backend,
    folders: ['Controllers', 'Comzada.Application/Controllers', 'ihelp.PublicApi',
      'Comzada.Application/Services', 'Comzada.Application/Repositories', 'Comzada.Application/Data',
      'Comzada.Service/ServicesMySQL', 'Comzada.Infra.Data/Repository', 'Comzada.Domain/Interfaces'] },
});
const API_DTO_FOLDERS = Object.freeze(['Comzada.Domain/EntitiesV2', 'Comzada.Domain/Entities_v2']);
export function productSparseFolders(role) {
  const folders = SOURCES[role]?.folders;
  if (!folders) throw new Error('Repositório do produto inválido');
  return [...new Set([...folders, ...(role === 'backend' ? API_DTO_FOLDERS : [])])];
}
const STOP = new Set(['para', 'pelo', 'pela', 'como', 'criar', 'configurar', 'codigo', 'code', 'de', 'com', 'uma', 'um']);
const ALIASES = { robo: ['robot'], robos: ['robot'], canal: ['channel'], canais: ['channel'], horario: ['schedule', 'hour'], horarios: ['schedule', 'hour'], departamento: ['department'], departamentos: ['department'], atendimento: ['attendance'], reconectar: ['reconnect', 'connection'], contatos: ['contacts'], campanha: ['campaign'] };

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function screenRoutes(topic, module) {
  const name = normalize(module).trim();
  const matches = coverageMatrix.filter((item) => normalize(item.module).trim() === name);
  if (matches.length) return matches.flatMap((item) => item.productRoutes);
  const terms = new Set(words(topic, module).map((term) => term.replace(/s$/u, '')));
  const inferred = coverageMatrix.filter((item) => normalize(item.module).split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.replace(/s$/u, '')).some((term) => term.length > 3 && terms.has(term)));
  return inferred.length === 1 ? inferred[0].productRoutes : [null];
}

function words(topic, module) {
  return [...new Set(`${topic} ${module}`.split(/[^\p{L}\p{N}]+/u).map(normalize)
    .filter((word) => word.length > 2)
    .flatMap((word) => [word, ...(uiSynonyms[word] ?? []), ...(ALIASES[word] ?? [])])
    .filter((word) => word.length > 2 && !STOP.has(word)))];
}

function lineKinds(path, content) {
  if (!/\.[jt]sx?$/u.test(path)) return null;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
    /\.tsx$/u.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const kinds = new Map();
  function mark(node, weight) {
    const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const last = source.getLineAndCharacterOfPosition(node.getEnd()).line;
    for (let line = first; line <= last; line++) kinds.set(line, Math.max(kinds.get(line) ?? 0, weight));
  }
  function visit(node) {
    if (ts.isJsxText(node) && node.getText(source).trim()) mark(node, 120);
    if (ts.isJsxAttribute(node) && /^(?:labelText|label|title|aria-label|placeholder)$/iu.test(node.name.text)) mark(node, 120);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return kinds;
}

export function isAllowedSourcePath(path, role = 'frontend', includeApiDto = false) {
  const folders = SOURCES[role]?.folders ?? [];
  const dto = includeApiDto && role === 'backend' && API_DTO_FOLDERS.some((folder) =>
    path.startsWith(`${folder}/`) && /^[\w/]+\.cs$/u.test(path.slice(folder.length + 1)));
  const publicConfigurationController = role === 'backend' && /^Comzada\.Application\/Controllers\/V2\/Configurations(?:Users|Departments)Controller\.cs$/u.test(path);
  return (dto || folders.some((folder) => path.startsWith(`${folder}/`)))
    && SOURCE.test(path) && !BLOCKED.test(path)
    && (!/(?:^|\/)data(?:\/|$)/iu.test(path) || (role === 'backend' && path.startsWith('Comzada.Application/Data/')))
    && (publicConfigurationController || !BLOCKED_FILE.test(path))
    && !path.startsWith('/') && !path.split('/').includes('..');
}

export function canReadFrontFile(path) {
  return typeof path === 'string' && path.startsWith('src/') && /\.tsx?$/u.test(path)
    && !path.includes('\\') && !path.split('/').some((part) => !part || part === '.' || part === '..')
    && (isAllowedSourcePath(path, 'frontend') || path === FRONT_ROUTER || path === 'src/translate/pt.ts');
}

function pathRelevance(path, terms, moduleTerms) {
  const value = normalize(path);
  const primary = [terms[0], ...(ALIASES[terms[0]] ?? [])];
  return (primary.some((term) => value.includes(term)) ? 50 : 0)
    + terms.filter((term) => value.includes(term)).length * 15
    + (moduleTerms.some((term) => value.includes(term)) ? 80 : 0)
    + (value.includes('/pages/') ? 10 : 0)
    + (/\/index\.tsx$/u.test(path) ? 4 : 0)
    - path.split('/').length * 2;
}

class DeadlineError extends Error {}

function deadlineContext(ms) {
  const until = Date.now() + ms;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref();
  return {
    signal: controller.signal,
    remaining() {
      const left = until - Date.now();
      if (left <= 0 || controller.signal.aborted) throw new DeadlineError('Prazo da busca local excedido');
      return left;
    },
    async wait(promise) {
      const left = this.remaining();
      let timeout;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new DeadlineError('Prazo da busca local excedido')), left);
        })]);
      } finally { clearTimeout(timeout); }
    },
    close() { clearTimeout(timer); controller.abort(); },
  };
}

async function command(commandName, args, options, deadline) {
  const { stdout } = await deadline.wait(run(commandName, args, {
    ...options, encoding: 'buffer', maxBuffer: 2 * 1024 * 1024,
    timeout: Math.min(TIMEOUT_MS, deadline.remaining()), signal: deadline.signal,
  }));
  return stdout;
}

async function git(root, deadline, ...args) {
  return command('git', ['-C', root, ...args], {}, deadline);
}

async function hasSymlink(path, stop = parse(path).root) {
  for (let current = path; current !== stop; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) return true;
  }
  return false;
}

async function candidatePaths(root, paths, terms, topic, deadline) {
  const first = terms[0];
  const originalFirst = normalize(String(topic).split(/[^\p{L}\p{N}]+/u)[0]);
  const accented = String(topic).split(/[^\p{L}\p{N}]+/u).find((word) => normalize(word) === first);
  const needles = [...new Set([first, originalFirst, accented, ...(uiSynonyms[first] ?? []), ...(ALIASES[first] ?? [])].filter(Boolean))];
  const candidates = [];
  for (let index = 0; index < paths.length; index += 500) {
    deadline.remaining();
    const safe = paths.slice(index, index + 500);
    if (!safe.length) continue;
    try {
      const stdout = await command('rg', ['--hidden', '-l', '-0', '-i', '-F', '--max-filesize', `${MAX_FILE_BYTES}`,
        ...needles.flatMap((term) => ['-e', term]), '--', ...safe], { cwd: root }, deadline);
      candidates.push(...stdout.toString().split('\0').filter(Boolean));
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          const stdout = await git(root, deadline, 'grep', '-z', '-l', '-i', ...needles.flatMap((term) => ['-e', term]), '--', ...safe);
          candidates.push(...stdout.toString().split('\0').filter(Boolean));
        } catch (fallbackError) {
          if (fallbackError.code !== 1) throw fallbackError;
        }
        continue;
      }
      if (error.code !== 1) throw error;
    }
  }
  return candidates;
}

function pending(source, reason) {
  return { available: false, repository: source.repository, ref: source.sha, role: source.role, matches: [], reason };
}

function sensitiveSource(content) {
  const normalized = content.normalize('NFKC').replace(/[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  return content.includes('\0') || containsSensitiveData(content, { detectOpaque: true }) || containsSensitiveData(normalized, { detectOpaque: true });
}

async function scan(source, topic, module, deadline, { readFile: reader = safeRead, stat = lstat, cache = true, explicitEndpoints = [] } = {}) {
  if (!source || !isAbsolute(source.root ?? '')) return pending(source ?? {}, 'Checkout autorizado ausente');
  try {
    if (await deadline.wait(hasSymlink(source.root))) return pending(source, 'Checkout por symlink não autorizado');
    const root = await deadline.wait(realpath(source.root));
    if ((await git(root, deadline, 'rev-parse', '--show-toplevel')).toString().trim() !== root) return pending(source, 'Raiz Git divergente');
    const sha = (await git(root, deadline, 'rev-parse', 'HEAD')).toString().trim();
    if (!SHA.test(sha)) return pending(source, 'SHA do checkout inválido');
    source = { ...source, sha };
    if ((await git(root, deadline, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Checkout com alterações não commitadas');
    const listKey = `${root}\0${sha}\0${source.role}\0${normalize(module) === 'api' ? 'api' : 'other'}`;
    let listed = cache ? listedCache.get(listKey) : undefined;
    if (!listed) {
      listed = (await git(root, deadline, 'ls-files', '-z')).toString().split('\0').filter(Boolean);
      if (cache) listedCache.set(listKey, listed);
    }
    if (listed.length > MAX_LISTED) return pending(source, 'Limite de arquivos listados excedido');
    const sourceAllowed = listed.filter((path) => source.role === 'frontend'
      ? canReadFrontFile(path) : isAllowedSourcePath(path, source.role, normalize(module) === 'api'));
    const blockedBackPaths = source.role === 'backend' ? listed.filter((path) => path.endsWith('.cs')
      && productSparseFolders('backend').some((folder) => path.startsWith(`${folder}/`))
      && !canReadBackFile(path)) : [];
    const allowed = sourceAllowed.filter((path) => source.role !== 'backend' || canReadBackFile(path));
    if (allowed.length > MAX_SEARCH_FILES) return pending(source, 'Limite de arquivos pesquisáveis excedido');
    const fileStat = (path) => source.role === 'backend'
      ? statBackFile(root, path, stat) : stat(join(root, path));
    const fileRead = (path, options) => source.role === 'backend'
      ? readBackFile(root, path, reader, options) : reader(join(root, path), options);
    let paths = cache ? eligibleCache.get(listKey) : undefined;
    if (!paths) {
      paths = [];
      let eligibleBytes = 0;
      for (let index = 0; index < allowed.length; index += 64) {
        deadline.remaining();
        const batch = await deadline.wait(Promise.all(allowed.slice(index, index + 64).map(async (path) => {
          const full = join(root, path);
          if (await hasSymlink(full, root)) return null;
          const size = (await fileStat(path)).size;
          return size <= MAX_FILE_BYTES ? { path, size } : null;
        })));
        for (const item of batch) {
          if (!item) continue;
          eligibleBytes += item.size;
          if (eligibleBytes > MAX_TOTAL_BYTES) return pending(source, 'Limite de bytes pesquisados excedido');
          paths.push(item.path);
        }
      }
      if (cache) eligibleCache.set(listKey, paths);
    }
    const terms = words(topic, module);
    const moduleTerms = words('', module);
    const phrase = normalize(topic).trim();
    if (!terms.length) return pending(source, 'Tema sem termos pesquisáveis');
    const rawTerms = [...new Set([...terms, ...`${topic} ${module}`.split(/[^\p{L}\p{N}]+/u).map((word) => word.toLowerCase())])];
    const searchPaths = source.role === 'backend' ? paths.filter((path) => /Controller\.cs$/u.test(path)) : paths;
    const textual = await candidatePaths(root, searchPaths, terms, topic, deadline);
    const pathFallback = searchPaths.filter((path) => moduleTerms.some((term) => normalize(path).includes(term)));
    const candidates = [...new Set([...textual, ...pathFallback])]
      .sort((a, b) => pathRelevance(b, terms, moduleTerms) - pathRelevance(a, terms, moduleTerms)).slice(0, 64);
    let totalBytes = 0;
    async function matchFile(path) {
      const full = join(root, path);
      deadline.remaining();
      if (await deadline.wait(hasSymlink(full, root))) return null;
      const actual = await deadline.wait(realpath(full));
      const rel = relative(root, actual);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return null;
      const size = (await deadline.wait(fileStat(path))).size;
      if (size > MAX_FILE_BYTES) return null;
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Limite de bytes pesquisados excedido');
      const fileKey = `${root}\0${sha}\0${path}`;
      let lines = cache ? fileCache.get(fileKey) : undefined;
      if (lines === undefined) {
        const content = (await deadline.wait(fileRead(path, { encoding: 'utf8', signal: deadline.signal }))).replace(/^\uFEFF/u, '');
        lines = sensitiveSource(content) ? null : content.split('\n');
        if (cache) fileCache.set(fileKey, lines);
      }
      if (!lines) return null;
      const kinds = lineKinds(path, lines.join('\n'));
      const pathScore = pathRelevance(path, terms, moduleTerms);
      let best = null;
      for (let index = 0; index < lines.length; index += 1) {
        deadline.remaining();
        const lower = lines[index].toLowerCase();
        if (!rawTerms.some((term) => term.length > 2 && lower.includes(term))) continue;
        const line = normalize(lines[index]);
        const hits = terms.filter((term) => line.includes(term)).length;
        if (!hits) continue;
        const typeScore = kinds?.get(index) ?? (/^\s*(?:\/\/|\/\*|\*)/u.test(lines[index]) ? -120 : /\b(?:import|using)\b/u.test(lines[index]) ? -80 : 0);
        const score = (phrase && line.includes(phrase) ? 100 : 0) + hits * 12 + pathScore + typeScore;
        if (!best || score > best.score) best = { score, line: index + 1, excerpt: lines.slice(Math.max(0, index - 2), index + 3).map((value, offset) => `${Math.max(0, index - 2) + offset + 1}: ${value.slice(0, 400)}`).join('\n').slice(0, 2_000) };
      }
      if (!best && moduleTerms.some((term) => normalize(path).includes(term))) {
        const index = lines.findIndex((line) => /\b(?:export|function|const|class)\b/u.test(line));
        if (index >= 0) best = { score: pathScore, line: index + 1, excerpt: `${index + 1}: ${lines[index].slice(0, 400)}` };
      }
      return best ? { repository: source.repository, role: source.role, path, sha: source.sha, ref: source.sha, line: best.line, excerpt: best.excerpt, score: best.score } : null;
    }
    const matches = [];
    for (const path of candidates) {
      deadline.remaining();
      const match = await matchFile(path);
      if (match) matches.push(match);
    }
    let screen = null;
    if (source.role === 'frontend' && paths.includes(FRONT_ROUTER)) {
      const routes = screenRoutes(topic, module);
      const screens = [];
      for (const route of routes) screens.push(await extractScreenFacts({ route, topic, module, paths, sha, readSource: async (path) => {
        if (!canReadFrontFile(path) || !paths.includes(path)) throw new Error('Arquivo do front não permitido');
        deadline.remaining();
        const full = join(root, path);
        if (await deadline.wait(hasSymlink(full, root))) throw new Error('Symlink do front não permitido');
        const content = await deadline.wait(fileRead(path, { encoding: 'utf8', signal: deadline.signal }));
        return content;
      } }));
      screen = { facts: screens.flatMap((item) => item.facts.map((fact) => ({ ...fact, route: item.route }))),
        code: [...new Map(screens.flatMap((item) => item.code).map((item) => [item.path, item])).values()],
        files: [...new Set(screens.flatMap((item) => item.files))], pending: [...screens.flatMap((item) => item.pending),
          ...(screens.every((item) => !item.facts.length) ? [`tela não identificada para ${module || topic}`] : [])] };
    }
    if ((await git(root, deadline, 'rev-parse', 'HEAD')).toString().trim() !== sha || (await git(root, deadline, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Fonte alterada durante a leitura');
    let endpoints = [];
    const callEvidence = [];
    if (source.role === 'backend' && (normalize(module) === 'api' || /\b(?:endpoint|\/api\/v\d)\b/iu.test(topic))) {
      const apiTerms = terms.filter((term) => term !== 'api');
      const controllerPaths = paths.filter((path) => /Controller\.cs$/u.test(path));
      const citedControllers = [];
      const scannedControllers = new Map();
      async function controllerData(path) {
        if (scannedControllers.has(path)) return scannedControllers.get(path);
        const full = join(root, path);
        const mtimeMs = (await deadline.wait(fileStat(path))).mtimeMs;
        const cached = cache ? controllerCache.get(full) : null;
        if (cached?.mtimeMs === mtimeMs) {
          scannedControllers.set(path, cached);
          return cached;
        }
        const content = await deadline.wait(fileRead(path, { signal: deadline.signal }));
        const data = { mtimeMs, content, shallow: readCsharpEndpoints(content, path, { dtoSources: [] }) };
        scannedControllers.set(path, data);
        if (cache) controllerCache.set(full, data);
        return data;
      }
      for (const path of controllerPaths) {
        if (!explicitEndpoints.length || await hasSymlink(join(root, path), root)) continue;
        const { shallow } = await controllerData(path);
        const matches = shallow.some((endpoint) => explicitEndpoints.some(({ route }) =>
          [endpoint.route, ...(endpoint.optionalAliases ?? [])].some((effective) =>
            routeMatches(route, effective) ||
            (!/^\/api\/v\d+\//iu.test(route) && routeMatches(route, effective.replace(/^\/api\/v\d+/iu, ''))))));
        if (matches) citedControllers.push(path);
      }
      const topicControllers = controllerPaths.filter((path) => apiTerms.some((term) => normalize(path).includes(term)))
        .sort((left, right) => pathRelevance(right, apiTerms, []) - pathRelevance(left, apiTerms, [])).slice(0, 16);
      const controllers = [...new Set([...citedControllers, ...topicControllers])];
      for (const path of controllers) {
        if (await hasSymlink(join(root, path), root)) continue;
        const { content, shallow } = await controllerData(path);
        const types = new Set(shallow.flatMap((endpoint) => endpoint.dtoTypes ?? []));
        const dtoSources = [];
        for (const dtoPath of paths.filter((candidate) => types.has(candidate.split('/').at(-1).replace(/\.cs$/u, ''))).slice(0, 16)) {
          if (await hasSymlink(join(root, dtoPath), root)) continue;
          const dtoContent = await deadline.wait(fileRead(dtoPath, { signal: deadline.signal }));
          dtoSources.push({ file: dtoPath, source: dtoContent });
        }
        const found = readCsharpEndpoints(content, path, { dtoSources }).map((endpoint) => ({ ...endpoint, file: path, sha }));
        endpoints.push(...found);
        for (const endpoint of found) {
          const sources = { [path]: content };
          // Filename resolution bounds reads to types named by reached methods.
          for (let depth = 0; depth < 3; depth++) {
            const trace = traceCsharpCalls(sources, Object.keys(sources), endpoint);
            const types = new Set(trace.neededTypes);
            for (const blocked of blockedBackPaths) {
              const type = blocked.split('/').at(-1).replace(/\.cs$/u, '');
              const reason = `arquivo de configuração não lido: ${type}`;
              if ((types.has(type) || types.has(`I${type}`)) && !endpoint.pending.includes(reason))
                endpoint.pending.push(reason);
            }
            const next = paths.filter((candidate) => types.has(candidate.split('/').at(-1).replace(/\.cs$/u, ''))
              || types.has(`I${candidate.split('/').at(-1).replace(/\.cs$/u, '')}`)).filter((candidate) => !(candidate in sources)).slice(0, 24);
            if (!next.length) break;
            for (const candidate of next) {
              if (await hasSymlink(join(root, candidate), root)) continue;
              const raw = await deadline.wait(fileRead(candidate, { signal: deadline.signal }));
              if (raw.length <= MAX_FILE_BYTES) sources[candidate] = raw;
            }
          }
          const trace = traceCsharpCalls(sources, Object.keys(sources), endpoint);
          endpoint.pending.push(...trace.pending);
          endpoint.errors = collectCsharpErrors(content, endpoint, trace.methods)
            .filter((error) => !containsSensitiveData(error.message, { detectOpaque: true }));
          if (endpoint.responseFields === null) {
            const outputType = trace.methods.find((item) => /\b(?:Task\s*<\s*)?(?:(?:List|IEnumerable)\s*<\s*)?[A-Za-z_]\w*\s*>+/u.test(item.excerpt));
            if (outputType) {
              const type = outputType.excerpt.match(/\b(?:Task\s*<\s*)?(?:(?:List|IEnumerable)\s*<\s*)?([A-Za-z_]\w*)\s*>+/u)?.[1];
              const dtoPath = paths.find((candidate) => candidate.split('/').at(-1) === `${type}.cs`);
              if (dtoPath && !dtoSources.some((item) => item.file === dtoPath) && !await hasSymlink(join(root, dtoPath), root)) {
                dtoSources.push({ file: dtoPath, source: await deadline.wait(fileRead(dtoPath, { signal: deadline.signal })) });
              }
              const primary = dtoSources.find((item) => item.file === dtoPath);
              if (primary) {
                const nestedTypes = [...primary.source.matchAll(/\bpublic\s+(?:List|IEnumerable|ICollection|IReadOnlyList)<\s*([A-Za-z_]\w*)\s*>\s+\w+\s*\{\s*get\s*;/gu)]
                  .map((match) => match[1]);
                for (const nestedType of [...new Set(nestedTypes)].slice(0, 8)) {
                  const nestedPath = paths.find((candidate) => candidate.split('/').at(-1) === `${nestedType}.cs`);
                  if (nestedPath && !dtoSources.some((item) => item.file === nestedPath) && !await hasSymlink(join(root, nestedPath), root))
                    dtoSources.push({ file: nestedPath, source: await deadline.wait(fileRead(nestedPath, { signal: deadline.signal })) });
                }
              }
              const resolved = readCsharpEndpoints(content, path, { dtoSources,
                serviceSources: Object.entries(sources).map(([file, source]) => ({ file, source })) })
                .find((item) => item.method === endpoint.method && item.route === endpoint.route);
              if (resolved?.responseFields) Object.assign(endpoint, { responseFields: resolved.responseFields,
                responseType: resolved.responseType, responseEnvelope: resolved.responseEnvelope,
                responseList: resolved.responseList, pending: [...endpoint.pending.filter((item) => !item.startsWith('campos de resposta não verificáveis:')), ...resolved.pending] });
            }
          }
          for (const method of trace.methods) {
            const excerpt = redactSensitiveData(method.excerpt);
            if (containsSensitiveData(excerpt, { detectOpaque: true })) {
              endpoint.pending.push(`trecho sensível: ${method.path}:${method.start}`);
              continue;
            }
            callEvidence.push({ ...method, excerpt, controllerFile: path, endpointKey: `${endpoint.verb} ${endpoint.route}`, repository: source.repository, ref: sha, sha });
          }
        }
      }
    }
    if ((await git(root, deadline, 'rev-parse', 'HEAD')).toString().trim() !== sha || (await git(root, deadline, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Fonte alterada durante a leitura');
    return { available: true, repository: source.repository, ref: source.sha, role: source.role, endpoints, callEvidence,
      screenFacts: screen?.facts.map((fact) => ({ ...fact, repository: source.repository, sha })) ?? [],
      screenCode: screen?.code ?? [], screenFiles: screen?.files ?? [], screenPending: screen?.pending ?? [], matches: matches
      .filter(({ path }) => redactSensitiveData(path) === path)
      .sort((a, b) => b.score - a.score).slice(0, 8)
      .map(({ score: _score, path, excerpt, ...match }) => ({ ...match, path, excerpt: redactSensitiveData(excerpt) })) };
  } catch (error) {
    if (error instanceof DeadlineError || error.code === 'ABORT_ERR') return { ...pending(source, 'Prazo da busca local excedido'), partial: true };
    if (error.killed || error.signal === 'SIGTERM') return pending(source, 'Tempo limite de subprocesso excedido');
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return pending(source, 'Limite de bytes do subprocesso excedido');
    return pending(source, `Checkout indisponível: ${error.code ?? 'leitura falhou'}`);
  }
}

export async function searchLocalProductContext(topic, module, { repositoryIds = Object.keys(SOURCES), deadlineMs = DEFAULT_DEADLINE_MS, readFile, stat, cache = true, explicitEndpoints = [] } = {}) {
  const deadline = deadlineContext(Math.max(1, deadlineMs));
  const code = [];
  try {
    // Pin the common generation once, before scanning either repository.
    const frontPath = process.env[SOURCES.frontend.env];
    const backPath = process.env[SOURCES.backend.env];
    const current = frontPath && backPath && dirname(frontPath) === dirname(backPath)
      && frontPath.endsWith('/checkouts/current/front') && backPath.endsWith('/checkouts/current/back')
      ? dirname(frontPath) : null;
    const generation = current ? await deadline.wait(realpath(current)).catch(() => null) : null;
    for (const id of repositoryIds) {
      const configured = SOURCES[id];
      if (!configured) { code.push(pending({ repository: id }, 'Repositório não autorizado')); continue; }
      const root = generation ? join(generation, id === 'frontend' ? 'front' : 'back') : process.env[configured.env];
      code.push(await scan({ repository: configured.repository, role: configured.role, root }, topic, module, deadline, { readFile, stat, cache, explicitEndpoints }));
    }
  } finally {
    deadline.close();
  }
  return { code, matches: code.flatMap((item) => item.matches), groundingRequired: true, partial: code.some((item) => item.partial === true) };
}
