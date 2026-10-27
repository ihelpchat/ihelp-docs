import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MCP_GIT_AUTHOR = Object.freeze({ name: 'iHelp MCP Bot', email: 'mcp-bot@users.noreply.github.com' });
const git = (root, ...args) => execFileSync('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const marker = (text) => text.match(/^mcpGeneratedSha:\s*['"]?([a-f0-9]{40})['"]?\s*$/m)?.[1];
const manual = (text) => /^manual:\s*true\s*$/m.test(text.match(/^---\n[\s\S]*?\n---/m)?.[0] ?? '');
const sections = (text) => {
  const matches = [...text.matchAll(/^#{2,6}\s+.+$/gm)];
  const result = new Map([['(preamble)', text.slice(0, matches[0]?.index ?? text.length)]]);
  const parents = [];
  for (let index = 0; index < matches.length; index += 1) {
    const heading = matches[index][0];
    const depth = heading.match(/^#+/)[0].length;
    while (parents.length && parents.at(-1).depth >= depth) parents.pop();
    parents.push({ depth, heading });
    const key = parents.map((part) => part.heading).join(' / ');
    if (result.has(key)) throw Error(`heading duplicado: ${key}`);
    result.set(key, text.slice(matches[index].index, matches[index + 1]?.index ?? text.length));
  }
  return result;
};
const comparable = (key, value) => key === '(preamble)' ? value?.replace(/^mcpGeneratedSha:.*\n/m, '') : value;
const withMarker = (text, sha) => marker(text)
  ? text.replace(/^mcpGeneratedSha:.*$/m, `mcpGeneratedSha: ${sha}`)
  : text.replace(/^---\n/, `---\nmcpGeneratedSha: ${sha}\n`);
const unavailable = (proposed) => ({ status: 'conflict', content: null,
  notice: `Histórico Git incompleto ou marcador MCP ausente. Revisão humana obrigatória; página preservada.\n\nVersão proposta:\n\n${proposed}` });

export async function reconcileHumanUpdate(root, path, proposed, expectedCurrent) {
  let current;
  try { current = await readFile(join(root, path), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return expectedCurrent === undefined
      ? { status: 'update', content: proposed, notice: '' } : unavailable(proposed);
    throw error;
  }
  if (expectedCurrent !== undefined && current !== expectedCurrent) return unavailable(proposed);
  if (manual(current)) return { status: 'manual', content: null,
    notice: `manual: true bloqueia reescrita de ${path}. Mudança proposta para revisão:\n\n${proposed}` };
  const start = marker(current);
  if (!start) return unavailable(proposed);
  let history; let head; let historicalPath;
  try {
    if (git(root, 'rev-parse', '--is-shallow-repository') !== 'false') return unavailable(proposed);
    const gitPath = join(git(root, 'rev-parse', '--show-prefix'), path);
    git(root, 'cat-file', '-e', `${start}^{commit}`);
    git(root, 'merge-base', '--is-ancestor', start, 'HEAD');
    head = git(root, 'rev-parse', 'HEAD');
    history = git(root, 'log', '--full-history', '--topo-order', '--format=%H%x00%an%x00%ae%x00%P', `${start}..HEAD`, '--', `:(top)${gitPath}`)
      .split('\n').filter(Boolean).map((line) => line.split('\0'));
    historicalPath = gitPath;
  } catch { return unavailable(proposed); }
  const bot = ([, , email]) => email === MCP_GIT_AUTHOR.email;
  const generated = history.find(bot);
  const textAt = (commit) => execFileSync('git', ['--no-pager', 'show', `${commit}:${historicalPath}`],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let generatedText;
  try { generatedText = textAt(generated?.[0] ?? start); }
  catch { return unavailable(proposed); }
  const humanCommits = history.filter((entry) => !bot(entry));
  if (!humanCommits.length) return { status: 'update', content: withMarker(proposed, head), notice: '' };
  let oldParts; let currentParts; let newParts;
  const humanSections = new Map();
  try {
    oldParts = sections(generatedText); currentParts = sections(current); newParts = sections(proposed);
    // O último blob do bot pode conter contribuições humanas preservadas.
    // Conserve a referência anterior à primeira contribuição de cada seção.
    for (const [sha, , , parents] of [...humanCommits].reverse()) {
      if (!parents) return unavailable(proposed);
      const editedParts = sections(textAt(sha));
      const parentParts = parents.split(' ').map((parent) => sections(textAt(parent)));
      // Conteúdo idêntico ao de algum pai foi herdado, não criado no merge.
      // A contribuição humana desse pai já foi registrada no seu próprio commit.
      for (const key of new Set([...editedParts.keys(), ...parentParts.flatMap((parts) => [...parts.keys()])])) {
        if (!humanSections.has(key) && parentParts.every((parts) =>
          comparable(key, parts.get(key)) !== comparable(key, editedParts.get(key)))) {
          humanSections.set(key, parentParts[0].get(key));
        }
      }
    }
  }
  catch { return unavailable(proposed); }
  const reference = (key) => humanSections.has(key) ? humanSections.get(key) : oldParts.get(key);
  const changes = [...new Set([...oldParts.keys(), ...newParts.keys(), ...humanSections.keys()])]
    .filter((key) => comparable(key, newParts.get(key)) !== comparable(key, reference(key))
      && comparable(key, newParts.get(key)) !== comparable(key, currentParts.get(key)))
    .map((key) => [key, newParts.get(key)]);
  const conflicts = changes.filter(([key]) => humanSections.has(key)
    || comparable(key, currentParts.get(key)) !== comparable(key, oldParts.get(key)));
  if (conflicts.length) return { status: 'conflict', content: null,
    notice: `Edição humana na seção afetada de ${path}. Página preservada; decisão necessária.\n\n${conflicts.map(([key, proposal]) => `${key}\n\nVersão humana:\n${currentParts.get(key) ?? '(seção ausente)'}\nVersão proposta:\n${proposal ?? '(seção removida)'}`).join('\n')}` };
  const merged = new Map(currentParts);
  for (const [key, value] of changes) {
    if (value === undefined) merged.delete(key);
    else merged.set(key, value);
  }
  const preserved = [...currentParts.keys()].filter((key) => !changes.some(([changed]) => changed === key));
  const proposedKeys = [...newParts.keys()];
  const extraKeys = [...merged.keys()].filter((key) => !newParts.has(key));
  const ordered = [...proposedKeys];
  for (const key of extraKeys) {
    const currentKeys = [...currentParts.keys()];
    const next = currentKeys.slice(currentKeys.indexOf(key) + 1).find((candidate) => ordered.includes(candidate));
    ordered.splice(next ? ordered.indexOf(next) : ordered.length, 0, key);
  }
  return { status: 'update', content: withMarker(ordered.map((key) => merged.get(key)).filter((value) => value !== undefined).join(''), start),
    notice: `Edição humana detectada em ${path}. Seções preservadas byte a byte: ${preserved.join(', ')}.` };
}
