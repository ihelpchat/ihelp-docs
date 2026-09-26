import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { stringify } from 'yaml';
import { compileGuidePackage } from '../lib/guide-package.mjs';
import { readArticle } from './editorial-standard.mjs';
import { validateArticle } from './content-service.mjs';
import { sensitiveKinds } from './sensitive-data.mjs';

const root = await mkdtemp(join(tmpdir(), 'm5-19-r3-'));
const contentRoot = join(root, 'content/docs');
await mkdir(contentRoot, { recursive: true });
const file = join(contentRoot, 'guia.mdx');
const guide = {
  schemaVersion: 1, guideId: 'reconectar-canal-qr', version: 1, mode: 'real', initialStepId: 'inicio',
  steps: [{ stepId: 'inicio', text: 'Abra Canais.', choices: [{ id: 'achei', label: 'Achei' }] }],
};
const base = { title: 'Guia público', description: 'Orientação pública de exemplo.', source: 'produto', contentType: 'guia', guide };
async function compile(fields = base) {
  await writeFile(file, `---\n${stringify(fields, { lineWidth: 0 })}---\n\n${'Orientação pública de exemplo. '.repeat(65)}`);
  return compileGuidePackage(root);
}

const valid = await compile();
assert.deepEqual(valid.catalog.guides[0].pathSegments, ['guia'], 'permalink mantém segmentos sem publicar rota fora do catálogo');
const delimiters = [
  "'/admin/operacoes'", '"/admin/operacoes"', '`/admin/operacoes`',
  '[/admin/operacoes]', '(/admin/operacoes)', '—/admin/operacoes',
  '/admin/operacoes', 'Acesse,/admin/operacoes,',
];
for (const value of [...delimiters, 'https://exemplo.test/ajuda']) {
  for (const field of ['title', 'text']) {
    const fields = field === 'title' ? { ...base, title: value }
      : { ...base, guide: { ...guide, steps: [{ ...guide.steps[0], text: value }] } };
    await assert.rejects(compile(fields), /rota|caractere|privado/i, `${field}: ${value}`);
  }
}
await compile({ ...base, guide: { ...guide, steps: [{ ...guide.steps[0], text: 'Abra /configuracoes/channel.' }] } });

for (const value of ['🟡', '🔴', 'INTERNO', 'CONFIDENCIAL', 'interno:', 'confidencial:', 'ІNTERNO:', 'CＯNFIDENCIAL:', 'I\u200bNTERNO:', 'C\u00adONFIDENCIAL:']) {
  assert.equal(sensitiveKinds(value).internal || sensitiveKinds(value).control, true, `marcador barrado: ${value}`);
}
for (const value of ['canal interno de comunicação', 'conteúdo confidencial da empresa', 'Interno', 'Confidencial']) {
  assert.equal(sensitiveKinds(value).internal, false, `prosa pública: ${value}`);
}

const projectRoot = new URL('../', import.meta.url).pathname;
const publishedRoot = join(projectRoot, 'content/docs');
async function filesUnder(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile() && path.endsWith('.mdx')) files.push(path);
  }
  return files;
}
const inventory = (await filesUnder(publishedRoot)).sort();
const checked = [];
const failures = {};
for (const file of inventory) {
  const path = relative(publishedRoot, file).replace(/\.mdx$/, '');
  try {
    const article = await readArticle(projectRoot, path);
    const result = validateArticle(article);
    if (!result.valid) failures[path] = result.issues;
  } catch (error) {
    failures[path] = [`readArticle: ${error.message}`];
  }
  checked.push(file);
}
// O corpus legado já contém falhas alheias à M5.19; a lista exata impede regressões novas.
const baseline = JSON.parse(await readFile(new URL('./published-corpus-baseline.json', import.meta.url), 'utf8'));
assert.deepEqual(failures, baseline, 'falhas do corpus precisam ficar limitadas ao baseline legado');
assert.equal(checked.length, 277, 'mudança no número de MDX publicados exige revisar o corpus');
assert.equal(checked.length, inventory.length, 'todo MDX publicado passa pelo caminho MCP');
assert.deepEqual(checked, inventory, 'nenhum artigo publicado pode ser omitido do corpus');
assert.equal(failures['docs/whatsapp-business-api/antes-de-migrar/deixarei-de-ter-acesso-a-algo'], undefined, 'prosa com interno deve passar');
console.log(`M5.19 r3: rotas e marcadores passaram; ${checked.length} artigos percorridos, ${Object.keys(failures).length} falhas legadas.`);
