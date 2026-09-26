import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { guideSchema, legacyGuideAliases, schemaVersion } from '../architecture/conversation-v1.mjs';
import { frontmatterFields } from '../mcp/article-fields.mjs';
import { parseArticle } from '../mcp/editorial-standard.mjs';
import { sensitiveKinds } from '../mcp/sensitive-data.mjs';
import productActions from '../architecture/product-actions.json' with { type: 'json' };

const packageVersion = 1;
const canonical = (value) => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
const contentSha256 = (value) => createHash('sha256').update(canonical(value)).digest('hex');
const publicRoutes = new Set(Object.values(productActions).map(({ route }) => route));
const versionOf = (output) => output.manifest.contentSha256.slice(0, 12);
const serialized = (value) => `${canonical(value)}\n`;

const allowedCharacters = /^[A-Za-zÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü0-9 .,;:!?()\[\]{}'"“”‘’…•●○◉—–\-_/\\@#%&+=*<>|$]+$/u;
export const routeSentenceEndPunctuation = /[.,;:!?)[\]}"'`“”‘’…]+$/u;

function validatePublicArtifact(artifact, name) {
  function visit(value, location, key) {
    if (typeof value === 'string') {
      const normalized = value.normalize('NFKC');
      for (const character of normalized) {
        if (!allowedCharacters.test(character)) {
          throw new Error(`${name}.${location}: caractere privado proibido U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
        }
      }
      const kinds = sensitiveKinds(value);
      if (key !== 'contentSha256' && (kinds.credential || kinds.personal || kinds.internal || kinds.control)) throw new Error(`${name}.${location}: dado privado ou interno`);
      for (const match of value.matchAll(/\/\S*/gu)) {
        const token = match[0];
        const route = token.replace(routeSentenceEndPunctuation, '');
        if (token.includes('?') || token.includes('#') || !publicRoutes.has(route)) throw new Error(`${name}.${location}: rota fora do catálogo: ${token}`);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) {
        visit(childKey, `${location}.key`);
        visit(child, `${location}.${childKey}`, childKey);
      }
    }
  }
  visit(artifact, '', undefined);
}

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
    const guide = guideSchema.parse(metadata.guide);
    if (ids.has(guide.guideId)) throw new Error(`${path}: guideId duplicado: ${guide.guideId}`);
    ids.add(guide.guideId);
    if (typeof metadata.title !== 'string' || typeof metadata.description !== 'string') throw new Error(`${path}: título ou descrição ausente`);
    guides.push({ pathSegments: path.split('/'), title: metadata.title, description: metadata.description,
      ...(metadata.assistantAliases?.length ? { aliases: metadata.assistantAliases } : {}),
      ...(metadata.assistantKeywords?.length ? { keywords: metadata.assistantKeywords } : {}), guide });
  }
  guides.sort((left, right) => left.guide.guideId < right.guide.guideId ? -1 : left.guide.guideId > right.guide.guideId ? 1 : 0);
  const aliases = { ...legacyGuideAliases };
  const content = { schemaVersion, version: packageVersion, aliases, guides };
  const sha = contentSha256(content);
  const output = {
    manifest: { ...content, contentSha256: sha },
    catalog: { schemaVersion, version: packageVersion, contentSha256: sha, guides },
    app: { schemaVersion, version: packageVersion, contentSha256: sha, aliases, guides: guides.map(({ guide }) => guide) },
  };
  validatePublicArtifact(output.catalog, 'catalog');
  validatePublicArtifact(output.app, 'app');
  return output;
}

export async function writeGuidePackage(root) {
  const output = await compileGuidePackage(root);
  const dir = join(root, 'public/guides');
  await mkdir(dir, { recursive: true });
  const version = versionOf(output);
  const versionDir = join(dir, version);
  await mkdir(versionDir, { recursive: true });
  for (const name of ['catalog', 'app']) {
    const file = join(versionDir, `${name}.json`);
    let existing;
    try { existing = await readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing !== undefined && existing !== serialized(output[name])) throw new Error(`Versão imutável alterada: ${file}`);
    if (existing === undefined) await writeFile(file, serialized(output[name]), { flag: 'wx' });
  }
  let previous;
  try { previous = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const versions = [...new Set([...(Array.isArray(previous?.versions) ? previous.versions : []), version])];
  await writeFile(join(dir, 'manifest.json'), serialized({ current: version, versions }));
  return output;
}

export async function checkGuidePackage(root) {
  const expected = await compileGuidePackage(root);
  const dir = join(root, 'public/guides');
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const current = versionOf(expected);
  if (manifest.current !== current || !Array.isArray(manifest.versions) || !manifest.versions.includes(current) || new Set(manifest.versions).size !== manifest.versions.length) {
    throw new Error('Manifest de guias desatualizado ou inválido');
  }
  const directories = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{12}$/u.test(entry.name)).map((entry) => entry.name).sort();
  if (canonical(directories) !== canonical([...manifest.versions].sort())) throw new Error('Manifest não lista todas as versões publicadas');
  for (const version of manifest.versions) {
    if (!/^[a-f0-9]{12}$/u.test(version)) throw new Error(`Versão inválida no manifest: ${version}`);
    const files = await Promise.all(['catalog', 'app'].map((name) => readFile(join(dir, version, `${name}.json`), 'utf8')));
    const [catalog, app] = files.map((raw) => JSON.parse(raw));
    const content = { schemaVersion: catalog.schemaVersion, version: catalog.version, aliases: app.aliases, guides: catalog.guides };
    const sha = contentSha256(content);
    if (sha.slice(0, 12) !== version || catalog.contentSha256 !== sha || app.contentSha256 !== sha || !Array.isArray(app.guides) || canonical(app.guides) !== canonical(catalog.guides.map(({ guide }) => guide)) || files[0] !== serialized(catalog) || files[1] !== serialized(app)) {
      throw new Error(`Versão publicada alterada: ${version}`);
    }
    if (version === current && (serialized(catalog) !== serialized(expected.catalog) || serialized(app) !== serialized(expected.app))) {
      throw new Error(`Versão atual desatualizada: ${version}`);
    }
  }
  return expected;
}
