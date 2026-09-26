import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, sep, dirname, parse } from 'node:path';
import { redactSensitiveData } from './sensitive-data.mjs';

const run = promisify(execFile);
const SOURCE = /\.(?:ts|tsx|js|jsx|cs)$/iu;
const BLOCKED = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|node_modules|dist|build|out|bin|obj|data|logs?|backups?|coverage|migrations?|secrets?|credentials?|fixtures?|__tests__|tests?|public)(?:\/|$)/iu;
const BLOCKED_FILE = /(?:^|\/)(?:[^/]*(?:secret|credential|token|private[-_]?key)[^/]*|[^/]*\.(?:min|designer|generated|spec|test)|styles?)\.(?:ts|tsx|js|jsx|cs)$/iu;
const SHA = /^[a-f0-9]{40}$/u;
const MAX_LISTED = 10_000;
const MAX_SEARCH_FILES = 4_096;
const MAX_FILE_BYTES = 256_000;
const MAX_TOTAL_BYTES = 64_000_000;
const TIMEOUT_MS = 2_000;
const SOURCES = Object.freeze({
  frontend: { repository: 'ihelpchat/front-react', role: 'frontend', env: 'PRODUCT_LOCAL_CHECKOUT' },
  backend: { repository: 'ihelpchat/olah-ihelp', role: 'backend', env: 'BACKEND_LOCAL_CHECKOUT' },
});
const STOP = new Set(['para', 'pelo', 'pela', 'como', 'criar', 'configurar', 'codigo', 'code', 'de', 'com', 'uma', 'um']);
const ALIASES = { robo: ['robot'], robos: ['robot'], canal: ['channel'], canais: ['channel'], horario: ['schedule', 'hour'], horarios: ['schedule', 'hour'], departamento: ['department'], departamentos: ['department'], atendimento: ['attendance'], reconectar: ['reconnect', 'connection'], contatos: ['contacts'], campanha: ['campaign'] };

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function words(topic, module) {
  return [...new Set(`${topic} ${module}`.split(/[^\p{L}\p{N}]+/u).map(normalize)
    .filter((word) => word.length > 2 && !STOP.has(word))
    .flatMap((word) => [word, ...(ALIASES[word] ?? [])]))];
}

export function isAllowedSourcePath(path) {
  return SOURCE.test(path) && !BLOCKED.test(path) && !BLOCKED_FILE.test(path)
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

async function git(root, ...args) {
  const { stdout } = await run('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: TIMEOUT_MS });
  return stdout;
}

async function hasSymlink(path, stop = parse(path).root) {
  for (let current = path; current !== stop; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) return true;
  }
  return false;
}

async function candidatePaths(root, paths, terms, topic) {
  const first = terms[0];
  const accented = String(topic).split(/[^\p{L}\p{N}]+/u).find((word) => normalize(word) === first);
  const needles = [...new Set([first, accented, ...(ALIASES[first] ?? [])].filter(Boolean))];
  const candidates = [];
  for (let index = 0; index < paths.length; index += 100) {
    const safe = paths.slice(index, index + 100);
    if (!safe.length) continue;
    try {
      const { stdout } = await run('rg', ['--hidden', '-l', '-0', '-i', '-F', ...needles.flatMap((term) => ['-e', term]), '--', ...safe], {
        cwd: root, encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: TIMEOUT_MS,
      });
      candidates.push(...stdout.toString().split('\0').filter(Boolean));
    } catch (error) {
      if (error.code !== 1) throw error;
    }
  }
  return candidates;
}

function pending(source, reason) {
  return { available: false, repository: source.repository, ref: source.sha, role: source.role, matches: [], reason };
}

async function scan(source, topic, module) {
  if (!source || !isAbsolute(source.root ?? '')) return pending(source ?? {}, 'Checkout autorizado ausente');
  try {
    if (await hasSymlink(source.root)) return pending(source, 'Checkout por symlink não autorizado');
    const root = await realpath(source.root);
    if ((await git(root, 'rev-parse', '--show-toplevel')).toString().trim() !== root) return pending(source, 'Raiz Git divergente');
    const sha = (await git(root, 'rev-parse', 'HEAD')).toString().trim();
    if (!SHA.test(sha)) return pending(source, 'SHA do checkout inválido');
    source = { ...source, sha };
    if ((await git(root, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Checkout com alterações não commitadas');
    const listed = (await git(root, 'ls-files', '-z')).toString().split('\0').filter(Boolean);
    if (listed.length > MAX_LISTED) return pending(source, 'Limite de arquivos listados excedido');
    const paths = listed.filter(isAllowedSourcePath);
    if (paths.length > MAX_SEARCH_FILES) return pending(source, 'Limite de arquivos pesquisáveis excedido');
    const terms = words(topic, module);
    const moduleTerms = words('', module);
    const phrase = normalize(topic).trim();
    if (!terms.length) return pending(source, 'Tema sem termos pesquisáveis');
    const rawTerms = [...new Set([...terms, ...`${topic} ${module}`.split(/[^\p{L}\p{N}]+/u).map((word) => word.toLowerCase())])];
    const ranked = paths.sort((a, b) => pathRelevance(b, terms, moduleTerms) - pathRelevance(a, terms, moduleTerms));
    const eligible = [];
    let totalBytes = 0;
    for (const path of ranked) {
      const full = join(root, path);
      if (await hasSymlink(full, root)) continue;
      const size = (await lstat(full)).size;
      if (size > MAX_FILE_BYTES) continue;
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_BYTES) return pending(source, 'Limite de bytes pesquisados excedido');
      eligible.push(path);
    }
    const textual = await candidatePaths(root, eligible, terms, topic);
    const candidates = [...new Set([...textual, ...eligible.filter((path) => terms.some((term) => normalize(path).includes(term)))])]
      .sort((a, b) => pathRelevance(b, terms, moduleTerms) - pathRelevance(a, terms, moduleTerms)).slice(0, 64);
    async function matchFile(path) {
      const full = join(root, path);
      if (await hasSymlink(full, root)) return null;
      const actual = await realpath(full);
      const rel = relative(root, actual);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return null;
      if ((await lstat(actual)).size > MAX_FILE_BYTES) return null;
      const handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
      let content;
      try { content = await handle.readFile('utf8'); } finally { await handle.close(); }
      if (content.includes('\0')) return null;
      const lines = content.split('\n');
      const pathScore = pathRelevance(path, terms, moduleTerms);
      let best = null;
      for (let index = 0; index < lines.length; index += 1) {
        const lower = lines[index].toLowerCase();
        if (!rawTerms.some((term) => term.length > 2 && lower.includes(term))) continue;
        const line = normalize(lines[index]);
        const hits = terms.filter((term) => line.includes(term)).length;
        if (!hits) continue;
        const score = (phrase && line.includes(phrase) ? 100 : 0) + hits * 12 + pathScore;
        if (!best || score > best.score) best = { score, line: index + 1, excerpt: lines.slice(Math.max(0, index - 2), index + 3).map((value, offset) => `${Math.max(0, index - 2) + offset + 1}: ${value.slice(0, 400)}`).join('\n').slice(0, 2_000) };
      }
      if (!best && moduleTerms.some((term) => normalize(path).includes(term))) {
        const index = lines.findIndex((line) => /\b(?:export|function|const|class)\b/u.test(line));
        if (index >= 0) best = { score: pathScore, line: index + 1, excerpt: `${index + 1}: ${lines[index].slice(0, 400)}` };
      }
      return best ? { repository: source.repository, role: source.role, path, sha: source.sha, ref: source.sha, line: best.line, excerpt: best.excerpt, score: best.score } : null;
    }
    const matches = [];
    for (let index = 0; index < candidates.length; index += 64) {
      matches.push(...(await Promise.all(candidates.slice(index, index + 64).map(matchFile))).filter(Boolean));
    }
    if ((await git(root, 'rev-parse', 'HEAD')).toString().trim() !== sha || (await git(root, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Fonte alterada durante a leitura');
    return { available: true, repository: source.repository, ref: source.sha, role: source.role, matches: matches
      .filter(({ path }) => redactSensitiveData(path) === path)
      .sort((a, b) => b.score - a.score).slice(0, 8)
      .map(({ score: _score, path, excerpt, ...match }) => ({ ...match, path, excerpt: redactSensitiveData(excerpt) })) };
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') return pending(source, 'Tempo limite de subprocesso excedido');
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return pending(source, 'Limite de bytes do subprocesso excedido');
    return pending(source, `Checkout indisponível: ${error.code ?? 'leitura falhou'}`);
  }
}

export async function searchLocalProductContext(topic, module, { repositoryIds = Object.keys(SOURCES) } = {}) {
  const code = [];
  for (const id of repositoryIds) {
    const configured = SOURCES[id];
    if (!configured) { code.push(pending({ repository: id }, 'Repositório não autorizado')); continue; }
    code.push(await scan({ repository: configured.repository, role: configured.role, root: process.env[configured.env] }, topic, module));
  }
  return { code, matches: code.flatMap((item) => item.matches), groundingRequired: true };
}
