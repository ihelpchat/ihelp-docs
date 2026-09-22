import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';

const projectRoot = new URL('../../', import.meta.url).pathname;
const pilotRoot = new URL('../', import.meta.url).pathname;
const contentRoot = join(pilotRoot, 'content/docs');
const preservedPages = new Set([
  'docs/index',
  'docs/principais-duvidas',
  'docs/sobre-o-sistema/atendimento',
  'docs/sobre-o-sistema/configuracoes/canais',
  'docs/sobre-o-sistema/configuracoes/gerenciamento-de-usuarios',
  'docs/sobre-o-sistema/relatorios',
  'api/index',
  'api/conceitos/autenticacao',
  'api/conceitos/obter-token',
  'api/mensagens/mensagem-comum',
  'tutoriais/index',
]);

function frontmatterValue(block, key) {
  const match = block.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

function descriptionFor(title, area) {
  if (area === 'api') return `Referência técnica da API do iHelp para ${title.toLocaleLowerCase('pt-BR')}.`;
  if (area === 'blog') return `Conheça a atualização ${title} e como ela funciona no iHelp.`;
  return `Entenda ${title} e veja como usar esse recurso no iHelp.`;
}

export function normalizeCallouts(body) {
  const lines = body.split('\n');
  const output = [];
  let open = false;

  for (const line of lines) {
    const start = line.match(/^:{3,}(tip|warning|danger|info)(?:\[([^\]]+)\])?\s*$/);
    if (start) {
      const type = { tip: 'idea', warning: 'warn', danger: 'error', info: 'info' }[start[1]];
      const title = start[2] ? ` title=${JSON.stringify(start[2])}` : '';
      output.push(`<Callout type="${type}"${title}>`);
      open = true;
      continue;
    }
    if (open && /^:{3,}\s*$/.test(line)) {
      output.push('</Callout>');
      open = false;
      continue;
    }
    output.push(line);
  }

  if (open) output.push('</Callout>');
  return output.join('\n');
}

function normalizeMarkdown(raw, area) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const originalFrontmatter = match?.[1] ?? '';
  let body = match ? raw.slice(match[0].length) : raw;
  const title = frontmatterValue(originalFrontmatter, 'title') ?? 'Documentação do iHelp';
  const source = area === 'api' ? 'api' : area === 'blog' ? 'produto' : 'produto';
  const contentType = area === 'api' ? 'referencia' : area === 'blog' ? 'guia' : 'faq';
  const extra = [];

  if (!frontmatterValue(originalFrontmatter, 'description')) {
    extra.push(`description: ${JSON.stringify(descriptionFor(title, area))}`);
  }
  if (!frontmatterValue(originalFrontmatter, 'source')) extra.push(`source: ${source}`);
  if (!frontmatterValue(originalFrontmatter, 'contentType')) extra.push(`contentType: ${contentType}`);

  body = normalizeCallouts(body)
    .replace(/\{\/\*\s*truncate\s*\*\/\}\s*/g, '')
    .replace(/\]\(([^)\s]+)\.md(x)?(#[^)]+)?\)/g, ']($1$3)')
    .replace(/[ \t]+$/gm, '');

  const frontmatter = [originalFrontmatter.trim(), ...extra].filter(Boolean).join('\n');
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
}

async function walkMarkdown(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await walkMarkdown(path));
    else if (['.md', '.mdx'].includes(extname(entry.name)) && entry.name !== '_category_.json') found.push(path);
  }
  return found;
}

async function migrateArea(area) {
  const sourceRoot = join(projectRoot, area);
  for (const sourcePath of await walkMarkdown(sourceRoot)) {
    const sourceRelative = relative(sourceRoot, sourcePath);
    const raw = await readFile(sourcePath, 'utf8');
    const slug = area === 'blog' ? frontmatterValue(raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '', 'slug') : undefined;
    const relativeTarget = slug ? `${slug}.mdx` : sourceRelative.replace(/\.mdx?$/, '.mdx');
    const routeKey = `${area}/${relativeTarget.replace(/\.mdx$/, '')}`;
    if (preservedPages.has(routeKey)) continue;

    const target = join(contentRoot, area, relativeTarget);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, normalizeMarkdown(raw, area));
  }
}

async function createMetaFiles(root, area) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) await createMetaFiles(join(root, entry.name), area);
  }

  const relativeDir = relative(join(contentRoot, area), root);
  const sourceCategory = join(projectRoot, area, relativeDir, '_category_.json');
  let category = {};
  try {
    category = JSON.parse(await readFile(sourceCategory, 'utf8'));
  } catch {}

  const current = await readdir(root, { withFileTypes: true });
  const pages = current
    .filter((entry) => entry.isDirectory() || entry.name.endsWith('.mdx'))
    .map((entry) => entry.isDirectory() ? entry.name : entry.name.replace(/\.mdx$/, ''))
    .sort((left, right) => left === 'index' ? -1 : right === 'index' ? 1 : left.localeCompare(right, 'pt-BR'));
  const existingMeta = join(root, 'meta.json');
  try {
    await readFile(existingMeta, 'utf8');
    return;
  } catch {}

  const title = category.label ?? (relativeDir ? relativeDir.split('/').at(-1).replaceAll('-', ' ') : area === 'blog' ? 'Novidades' : area);
  await writeFile(existingMeta, `${JSON.stringify({ title, pages }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
for (const area of ['docs', 'api', 'blog']) {
  await migrateArea(area);
  await createMetaFiles(join(contentRoot, area), area);
}

await cp(join(projectRoot, 'static/img'), join(pilotRoot, 'public/img'), { recursive: true });
await cp(join(projectRoot, 'static/videos'), join(pilotRoot, 'public/videos'), { recursive: true });

await writeFile(join(contentRoot, 'meta.json'), `${JSON.stringify({ pages: ['docs', 'tutoriais', 'api', 'blog'] }, null, 2)}\n`);

console.log('Conteúdo legado migrado para MDX, com metadados e assets preservados.');
}
