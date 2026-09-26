import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectGaps } from './lacunas.mjs';
import { publishedCoverage } from './published-coverage.mjs';
import { saveSessionEvent } from './session-events.mjs';

const realRoot = new URL('../', import.meta.url).pathname;
const key = JSON.stringify(['abrir-usuarios', 'criar']);
const realCoverage = await publishedCoverage(realRoot);
assert.ok(realCoverage.some(({ pageId, keys }) => pageId === 'usuario-acesso' && keys.includes(key)),
  'o alias publicado "criar usuário" cobre a mesma chave dos eventos');

const now = Date.now();
async function scenario(pageBodies, publishedRoot) {
  const root = publishedRoot ?? await mkdtemp(join(tmpdir(), 'm540-coverage-'));
  if (!publishedRoot) {
    const docs = join(root, 'content/docs');
    await mkdir(docs, { recursive: true });
    for (const [name, body] of Object.entries(pageBodies)) await writeFile(join(docs, `${name}.mdx`), body);
  }
  const file = join(await mkdtemp(join(tmpdir(), 'm540-events-')), 'events.jsonl');
  for (let i = 1; i <= 3; i++) await saveSessionEvent(file, {
    origin: 'faq', durationMs: 20, result: 'partial', path: '/assistente', issue: 'usage',
    sessionId: `coverage-${i}`, topic: 'abrir-usuarios', action: 'criar',
  }, { now });
  return collectGaps(root, file, { now });
}

const aliasPage = `---\ntitle: "Equipe"\nassistantAliases:\n  - "Como criar usuário?"\n---\nTexto público.\n`;
const headingPage = `---\ntitle: "Equipe"\n---\n## Como criar usuário?\nTexto público.\n`;
const withoutCoverage = `---\ntitle: "Equipe"\n---\n## Como editar usuário?\nTexto público.\n`;

let result = await scenario({}, realRoot);
assert.equal(result.documentable[0]?.proposal, 'atualizar', 'três sessões de criar usuário reutilizam o guia publicado');
assert.equal(result.documentable[0]?.guideId, 'usuario-acesso');

result = await scenario({ 'alias-only': aliasPage });
assert.equal(result.documentable[0]?.proposal, 'atualizar', 'alias sem assistantQuestion cobre a ação');
assert.equal(result.documentable[0]?.guideId, 'alias-only');

result = await scenario({ 'heading-only': headingPage });
assert.equal(result.documentable[0]?.proposal, 'atualizar', 'heading H2 cobre a ação');
assert.equal(result.documentable[0]?.guideId, 'heading-only');

result = await scenario({ 'alias-only': aliasPage, 'second-page': headingPage });
assert.deepEqual(result.documentable, [], 'duas páginas com a chave não escolhem destino');
assert.equal(result.review[0]?.reason, 'mais de um guia — revisão humana');

result = await scenario({ 'alias-only': aliasPage.replace('criar usuário', 'editar usuário') });
assert.equal(result.documentable[0]?.proposal, 'criar', 'uma alteração no alias remove a cobertura');

result = await scenario({ 'heading-only': headingPage.replace('criar usuário', 'editar usuário') });
assert.equal(result.documentable[0]?.proposal, 'criar', 'uma alteração no heading remove a cobertura');

result = await scenario({ 'without-coverage': withoutCoverage });
assert.equal(result.documentable[0]?.proposal, 'criar', 'chave sem página publicada cria proposta');
console.log('lacunas: cobertura publicada e equivalência de classificação ok');
