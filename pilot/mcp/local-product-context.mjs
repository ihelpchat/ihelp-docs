import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { redactSensitiveData } from './sensitive-data.mjs';

const run = promisify(execFile);
const SOURCE = /\.(?:ts|tsx|js|jsx|cs)$/iu;
const BLOCKED = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|node_modules|dist|build|out|bin|obj|data|logs?|backups?|coverage|migrations?|secrets?|credentials?|fixtures?|__tests__|tests?|public)(?:\/|$)/iu;
const BLOCKED_FILE = /(?:^|\/)(?:(?:credentials?|secrets?|tokens?|private[-_]?keys?)(?:\.[^/]*)?|[^/]*\.(?:min|designer|generated|spec|test)\.(?:ts|tsx|js|jsx|cs))$/iu;
const SHA = /^[a-f0-9]{40}$/u;
const STOP = new Set(['para', 'pelo', 'pela', 'como', 'criar', 'configurar', 'codigo', 'code', 'de', 'com', 'uma', 'um']);
const ALIASES = { robo: ['robot'], robos: ['robot'], canal: ['channel'], canais: ['channel'], horario: ['schedule', 'hour'], horarios: ['schedule', 'hour'], departamento: ['department'], departamentos: ['department'], atendimento: ['attendance'], reconectar: ['reconnect'], contatos: ['contacts'], campanha: ['campaign'] };

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
}

function words(topic, module) {
  return [...new Set(`${topic} ${module}`.split(/[^\p{L}\p{N}]+/u).map(normalize)
    .filter((word) => word.length > 2 && !STOP.has(word))
    .flatMap((word) => [word, ...(ALIASES[word] ?? [])]))];
}

function safePath(path) {
  return SOURCE.test(path) && !BLOCKED.test(path) && !BLOCKED_FILE.test(path)
    && !path.startsWith('/') && !path.split('/').includes('..');
}

async function git(root, ...args) {
  const { stdout } = await run('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

function pending(source, reason) {
  return { available: false, repository: source.repository, ref: source.sha, role: source.role, matches: [], reason };
}

async function scan(source, topic, module) {
  if (!source || !isAbsolute(source.root ?? '') || !SHA.test(source.sha ?? '')) return pending(source ?? {}, 'Checkout ou SHA esperado ausente');
  try {
    if ((await lstat(source.root)).isSymbolicLink()) return pending(source, 'Checkout por symlink não autorizado');
    const root = await realpath(source.root);
    if ((await git(root, 'rev-parse', '--show-toplevel')).toString().trim() !== root) return pending(source, 'Raiz Git divergente');
    if ((await git(root, 'rev-parse', 'HEAD')).toString().trim() !== source.sha) return pending(source, 'SHA divergente');
    if ((await git(root, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Checkout com alterações não commitadas');
    const paths = (await git(root, 'ls-files', '-z')).toString().split('\0').filter(safePath);
    const terms = words(topic, module);
    const phrase = normalize(topic).trim();
    const matches = [];
    for (const path of paths) {
      const full = join(root, path);
      if ((await lstat(full)).isSymbolicLink()) continue;
      const actual = await realpath(full);
      const rel = relative(root, actual);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) continue;
      if ((await lstat(actual)).size > 256_000) continue;
      const content = await readFile(actual, 'utf8');
      if (content.includes('\0')) continue;
      const lines = content.split('\n');
      let best = null;
      for (let index = 0; index < lines.length; index += 1) {
        const line = normalize(lines[index]);
        const hits = terms.filter((term) => line.includes(term)).length;
        if (!hits) continue;
        const score = (phrase && line.includes(phrase) ? 100 : 0) + hits * 12 + (normalize(path).includes(normalize(module)) ? 8 : 0);
        if (!best || score > best.score) best = { score, line: index + 1, excerpt: lines.slice(Math.max(0, index - 2), index + 3).map((value, offset) => `${Math.max(0, index - 2) + offset + 1}: ${value}`).join('\n') };
      }
      if (best) matches.push({ repository: source.repository, role: source.role, path: redactSensitiveData(path), sha: source.sha, ref: source.sha, line: best.line, excerpt: redactSensitiveData(best.excerpt), score: best.score });
    }
    if ((await git(root, 'rev-parse', 'HEAD')).toString().trim() !== source.sha || (await git(root, 'status', '--porcelain', '--untracked-files=no')).length) return pending(source, 'Fonte alterada durante a leitura');
    return { available: true, repository: source.repository, ref: source.sha, role: source.role, matches: matches.sort((a, b) => b.score - a.score).slice(0, 8).map(({ score: _score, ...match }) => match) };
  } catch {
    return pending(source, 'Checkout indisponível');
  }
}

export async function searchLocalProductContext(topic, module, { checkouts = [] } = {}) {
  const code = [];
  for (const source of checkouts) code.push(await scan(source, topic, module));
  return { code, matches: code.flatMap((item) => item.matches), groundingRequired: true };
}
