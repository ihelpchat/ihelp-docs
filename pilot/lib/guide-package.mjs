import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { guideSchema, legacyGuideAliases, schemaVersion } from '../architecture/conversation-v1.mjs';
import { frontmatterFields } from '../mcp/article-fields.mjs';
import { parseArticle } from '../mcp/editorial-standard.mjs';
import { sensitiveKinds } from '../mcp/sensitive-data.mjs';

const packageVersion = 1;
const canonical = (value) => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
const contentSha256 = (value) => createHash('sha256').update(canonical(value)).digest('hex');

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile() && entry.name.endsWith('.mdx')) files.push(file);
  }
  return files.sort();
}

export async function compileGuidePackage(root) {
  const contentRoot = join(root, 'content/docs');
  const guides = [];
  const ids = new Set();
  for (const file of await walk(contentRoot)) {
    const path = relative(contentRoot, file).replace(/\.mdx$/, '').replace(/\/index$/, '');
    const raw = await readFile(file, 'utf8');
    const { metadata } = parseArticle(raw, path);
    if (metadata.guide === undefined) continue;
    const unknown = Object.keys(metadata).filter((key) => !frontmatterFields.has(key));
    if (unknown.length) throw new Error(`${path}: campo desconhecido: ${unknown.join(', ')}`);
    const privateData = sensitiveKinds(raw);
    if (privateData.credential || privateData.personal) throw new Error(`${path}: dado privado no guia`);
    const guide = guideSchema.parse(metadata.guide);
    if (ids.has(guide.guideId)) throw new Error(`${path}: guideId duplicado: ${guide.guideId}`);
    ids.add(guide.guideId);
    if (typeof metadata.title !== 'string' || typeof metadata.description !== 'string') throw new Error(`${path}: título ou descrição ausente`);
    guides.push({ path: `/${path}`, title: metadata.title, description: metadata.description, guide });
  }
  guides.sort((left, right) => left.guide.guideId < right.guide.guideId ? -1 : left.guide.guideId > right.guide.guideId ? 1 : 0);
  const aliases = { ...legacyGuideAliases };
  const content = { schemaVersion, version: packageVersion, aliases, guides };
  const sha = contentSha256(content);
  return {
    manifest: { ...content, contentSha256: sha },
    catalog: { schemaVersion, version: packageVersion, contentSha256: sha, guides },
    app: { schemaVersion, version: packageVersion, contentSha256: sha, aliases, guides: guides.map(({ guide }) => guide) },
  };
}

export async function writeGuidePackage(root) {
  const output = await compileGuidePackage(root);
  const dir = join(root, 'public/guides');
  await mkdir(dir, { recursive: true });
  for (const [name, data] of Object.entries(output)) {
    await writeFile(join(dir, `${name}.json`), `${canonical(data)}\n`);
  }
  return output;
}
