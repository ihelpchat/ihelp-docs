import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const git = (root, ...args) => execFileSync('git', ['--no-pager', ...args],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();

export async function adoptMarkers(root) {
  const paths = git(root, 'ls-files', '-z', '--', 'pilot/content/docs')
    .split('\0').filter((path) => path.endsWith('.mdx'));
  let count = 0;
  for (const path of paths) {
    const text = await readFile(join(root, path), 'utf8');
    const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    if (!frontmatter) throw Error(`frontmatter ausente: ${path}`);
    if (/^manual:\s*true\s*$/m.test(frontmatter[0]) || /^mcpGeneratedSha:/m.test(frontmatter[0])) continue;
    const lastTouch = git(root, 'log', '-1', '--format=%H', '--', path);
    if (!/^[a-f0-9]{40}$/.test(lastTouch)) throw Error(`histórico ausente: ${path}`);
    const newline = frontmatter[0].startsWith('---\r\n') ? '\r\n' : '\n';
    await writeFile(join(root, path), text.replace(/^---\r?\n/, `---${newline}mcpGeneratedSha: ${lastTouch}${newline}`));
    count += 1;
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(`Páginas adotadas: ${await adoptMarkers(root)}`);
}
