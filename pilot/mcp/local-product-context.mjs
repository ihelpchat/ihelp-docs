import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, sep, dirname, parse } from 'node:path';
import { containsSensitiveData, redactSensitiveData } from './sensitive-data.mjs';
import { envCompatibility } from './env-compat.mjs';
import ts from 'typescript';
import uiSynonyms from './ui-synonyms.json' with { type: 'json' };
import { readCsharpEndpoints } from '../lib/csharp-endpoints.mjs';

const run = promisify(execFile);
const SOURCE = /\.(?:ts|tsx|js|jsx|cs)$/iu;
const BLOCKED = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|node_modules|dist|build|out|bin|obj|data|logs?|backups?|coverage|migrations?|secrets?|credentials?|fixtures?|__tests__|tests?|public)(?:\/|$)/iu;
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
const SOURCES = Object.freeze({
  frontend: { repository: 'ihelpchat/front-react', role: 'frontend', env: envCompatibility.localCheckouts.frontend,
    folders: ['src/components', 'src/pages', 'src/features', 'src/routes'] },
  backend: { repository: 'ihelpchat/olah-ihelp', role: 'backend', env: envCompatibility.localCheckouts.backend,
    folders: ['Controllers', 'Comzada.Application/Controllers', 'ihelp.PublicApi'] },
});
const STOP = new Set(['para', 'pelo', 'pela', 'como', 'criar', 'configurar', 'codigo', 'code', 'de', 'com', 'uma', 'um']);
const ALIASES = { robo: ['robot'], robos: ['robot'], canal: ['channel'], canais: ['channel'], horario: ['schedule', 'hour'], horarios: ['schedule', 'hour'], departamento: ['department'], departamentos: ['department'], atendimento: ['attendance'], reconectar: ['reconnect', 'connection'], contatos: ['contacts'], campanha: ['campaign'] };

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
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
  const dto = includeApiDto && role === 'backend' && /^Comzada\.Domain\/Entities(?:V2|_v2)\/[\w/]+\.cs$/u.test(path);
  const publicConfigurationController = role === 'backend' && /^Comzada\.Application\/Controllers\/V2\/Configurations(?:Users|Departments)Controller\.cs$/u.test(path);
  return (dto || folders.some((folder) => path.startsWith(`${folder}/`)))
    && SOURCE.test(path) && !BLOCKED.test(path) && (publicConfigurationController || !BLOCKED_FILE.test(path))
    && !path.startsWith('/') && !path.split('/').includes('..');
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

async function safeRead(path, { signal }) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await handle.readFile({ encoding: 'utf8', signal }); }
  finally { await handle.close(); }
}

async function scan(source, topic, module, deadline, { readFile: reader = safeRead, cache = true } = {}) {
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
    const allowed = listed.filter((path) => isAllowedSourcePath(path, source.role, normalize(module) === 'api'));
    if (allowed.length > MAX_SEARCH_FILES) return pending(source, 'Limite de arquivos pesquisáveis excedido');
    let paths = cache ? eligibleCache.get(listKey) : undefined;
    if (!paths) {
      paths = [];
      let eligibleBytes = 0;
      for (let index = 0; index < allowed.length; index += 64) {
        deadline.remaining();
        const batch = await deadline.wait(Promise.all(allowed.slice(index, index + 64).map(async (path) => {
          const full = join(root, path);
          if (await hasSymlink(full, root)) return null;
          const size = (await lstat(full)).size;
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
    const textual = await candidatePaths(root, paths, terms, topic, deadline);
    const pathFallback = paths.filter((path) => moduleTerms.some((term) => normalize(path).includes(term)));
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
      const size = (await deadline.wait(lstat(actual))).size;
      if (size > MAX_FILE_BYTES) return null;
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Limite de bytes pesquisados excedido');
      const fileKey = `${root}\0${sha}\0${path}`;
      let lines = cache ? fileCache.get(fileKey) : undefined;
      if (lines === undefined) {
        const content = (await deadline.wait(reader(actual, { encoding: 'utf8', signal: deadline.signal }))).replace(/^\uFEFF/u, '');
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
    if ((await git(root, deadline, 'rev-parse', 'HEAD')).toString().trim() !== sha || (await git(root, deadline, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Fonte alterada durante a leitura');
    let endpoints = [];
    if (source.role === 'backend' && (normalize(module) === 'api' || /\b(?:endpoint|\/api\/v\d)\b/iu.test(topic))) {
      const apiTerms = terms.filter((term) => term !== 'api');
      const controllers = paths.filter((path) => /Controller\.cs$/u.test(path) && apiTerms.some((term) => normalize(path).includes(term)))
        .sort((left, right) => pathRelevance(right, apiTerms, []) - pathRelevance(left, apiTerms, [])).slice(0, 16);
      for (const path of controllers) {
        if (await hasSymlink(join(root, path), root)) continue;
        const content = await deadline.wait(reader(join(root, path), { signal: deadline.signal }));
        const shallow = readCsharpEndpoints(content, path, { dtoSources: [] });
        const types = new Set(shallow.flatMap((endpoint) => endpoint.dtoTypes ?? []));
        const dtoSources = [];
        for (const dtoPath of paths.filter((candidate) => types.has(candidate.split('/').at(-1).replace(/\.cs$/u, ''))).slice(0, 16)) {
          if (await hasSymlink(join(root, dtoPath), root)) continue;
          const dtoContent = await deadline.wait(reader(join(root, dtoPath), { signal: deadline.signal }));
          dtoSources.push({ file: dtoPath, source: dtoContent });
        }
        endpoints.push(...readCsharpEndpoints(content, path, { dtoSources }).map((endpoint) => ({ ...endpoint, file: path, sha })));
      }
    }
    if ((await git(root, deadline, 'rev-parse', 'HEAD')).toString().trim() !== sha || (await git(root, deadline, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Fonte alterada durante a leitura');
    return { available: true, repository: source.repository, ref: source.sha, role: source.role, endpoints, matches: matches
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

export async function searchLocalProductContext(topic, module, { repositoryIds = Object.keys(SOURCES), deadlineMs = DEFAULT_DEADLINE_MS, readFile, cache = true } = {}) {
  const deadline = deadlineContext(Math.max(1, deadlineMs));
  const code = [];
  try {
    for (const id of repositoryIds) {
      const configured = SOURCES[id];
      if (!configured) { code.push(pending({ repository: id }, 'Repositório não autorizado')); continue; }
      code.push(await scan({ repository: configured.repository, role: configured.role, root: process.env[configured.env] }, topic, module, deadline, { readFile, cache }));
    }
  } finally {
    deadline.close();
  }
  return { code, matches: code.flatMap((item) => item.matches), groundingRequired: true, partial: code.some((item) => item.partial === true) };
}
