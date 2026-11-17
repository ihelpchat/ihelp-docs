import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { businessChunks, moduleResolver, supportChunks } from './kb-chunk.mjs';
import { openKnowledgeBase } from './kb-store.mjs';

// --- fontes internas ---
const moduleOf = moduleResolver([{ module: 'Campanhas', docs: ['/docs/sobre-o-sistema/campanhas'] }, { module: 'Agenda de Contatos', docs: ['/docs/sobre-o-sistema/agenda-de-contatos'] }]);
assert.equal(moduleOf('docs/sobre-o-sistema/campanhas/como-criar-uma-nova-campanha'), 'campanhas', 'página filha herda o módulo');
assert.equal(moduleOf('docs/sobre-o-sistema/agenda-de-contatos'), 'agenda-de-contatos');
assert.equal(moduleOf('docs/sobre-o-sistema/campanhas-extra'), null, 'prefixo parecido não é filho');

const support = supportChunks({ categories: [{ category: 'Reconexão de número e canal', conversations: 42, selfService: 'partial', guidance: 'Ensinar QR Code.' }], rules: ['Bug não vira tutorial.'] });
assert.equal(support.length, 2);
assert.ok(support.every(({ source, visibility }) => source === 'suporte' && visibility === 'interna'));

const business = businessChunks([{ path: 'business-context/campanhas.md', body: '# Campanhas\n\n🟢 PÚBLICO\n\n## Risco no QR\n\nCanal por QR é mais suscetível a bloqueio em disparo em massa.' }]);
assert.ok(business.some(({ title, module, source }) => title === 'Campanhas › Risco no QR' && module === 'campanhas' && source === 'negocio'));

// --- base montada de um conteúdo de teste, com vetores guardados em disco ---
const dir = await mkdtemp(join(tmpdir(), 'kb-store-'));
try {
  const root = join(dir, 'pilot'); const stateDir = join(dir, 'state');
  await mkdir(join(root, 'content/docs/docs/campanhas'), { recursive: true });
  await mkdir(join(root, 'architecture'), { recursive: true });
  await writeFile(join(root, 'content/docs/docs/campanhas/index.mdx'), '---\ntitle: Campanhas\ndescription: Dispare mensagens.\n---\n\nEnvie para uma lista.\n\n## Como criar\n\nAbra **Campanhas**.\n');
  await writeFile(join(root, 'architecture/coverage-matrix.json'), JSON.stringify([{ module: 'Campanhas', docs: ['/docs/campanhas'] }]));
  await writeFile(join(root, 'architecture/support-signals.json'), JSON.stringify({ categories: [], rules: ['Bug não vira tutorial.'] }));

  let sent = 0;
  const embedder = { model: 'teste', embed: async (texts) => { sent += texts.length; return texts.map((text) => [text.length, 1]); }, embedQuery: async () => [1, 1] };
  const first = await openKnowledgeBase(root, { stateDir, embedder, businessContext: [{ path: 'business-context/campanhas.md', body: '# Campanhas\n\n## Risco no QR\n\nQR é mais suscetível a bloqueio.' }] });
  assert.equal(first.embedded, first.index.chunks.length);
  assert.equal(first.withVectors, first.index.chunks.length);
  assert.ok(first.index.chunks.filter(({ source }) => source === 'faq').every(({ module }) => module === 'campanhas'));

  const second = await openKnowledgeBase(root, { stateDir, embedder, businessContext: [{ path: 'business-context/campanhas.md', body: '# Campanhas\n\n## Risco no QR\n\nQR é mais suscetível a bloqueio.' }] });
  assert.equal(second.embedded, 0, 'segunda subida não paga de novo');
  assert.equal(second.index.version, first.index.version);

  await writeFile(join(root, 'content/docs/docs/campanhas/nova.mdx'), '---\ntitle: Agendar campanha\n---\n\nEscolha data e hora.\n');
  const third = await openKnowledgeBase(root, { stateDir, embedder });
  assert.equal(third.embedded, 1, 'só o trecho novo é enviado');
  assert.notEqual(third.index.version, first.index.version);

  const interno = await third.search({ query: 'bloqueio', visibility: 'publica' });
  assert.equal(interno.hits.filter(({ chunk }) => chunk.visibility !== 'publica').length, 0);

  const quebrado = { model: 'fora', embed: async () => { throw new Error('timeout'); }, embedQuery: async () => null };
  const logs = [];
  const degraded = await openKnowledgeBase(root, { stateDir, embedder: quebrado, log: (line) => logs.push(line) });
  assert.equal(degraded.withVectors, 0);
  assert.equal((await degraded.search({ query: 'agendar campanha' })).degraded, true);
  assert.match(logs[0], /vetores incompletos/);
  assert.ok(sent > 0);
} finally { await rm(dir, { recursive: true, force: true }); }

console.log('base de conhecimento: fontes internas, módulo por página, vetores incrementais e provedor fora.');

// --- Claricia: página achada só pelo sentido entra no contexto e sobe; sem a base, nada muda ---
{
  const { retrieveContext, semanticRanksFor } = await import('./assistant-service.mjs');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const assert = (await import('node:assert/strict')).default;
  const site = await mkdtemp(join(tmpdir(), 'kb-claricia-'));
  await mkdir(join(site, 'content/docs/docs'), { recursive: true });
  const page = (title, body) => `---\ntitle: ${title}\ndescription: ${title}\n---\n\n${body}\n`;
  await writeFile(join(site, 'content/docs/docs/reconectar.mdx'), page('Reconectar canal por QR Code', 'Leia o código para voltar a atender.'));
  await writeFile(join(site, 'content/docs/docs/caiu.mdx'), page('Quando o sistema caiu', 'Meu numero caiu e a internet também.'));
  const before = await retrieveContext(site, 'meu numero caiu');
  assert.deepEqual(before.map(({ path }) => path), ['/docs/caiu']);
  const search = async () => ({ hits: [{ chunk: { ref: { path: 'docs/reconectar' } } }, { chunk: { ref: { path: 'docs/reconectar' } } }] });
  const ranks = await semanticRanksFor(search, 'meu numero caiu');
  assert.deepEqual([...ranks], [['/docs/reconectar', 1]]);
  const after = await retrieveContext(site, 'meu numero caiu', 6, { semanticRanks: ranks });
  assert.equal(after[0].path, '/docs/reconectar', 'achado pelo sentido passa na frente');
  assert.equal((await semanticRanksFor(async () => { throw new Error('fora'); }, 'meu numero caiu')).size, 0, 'base fora não quebra a Claricia');
  assert.equal((await semanticRanksFor(null, 'meu numero caiu')).size, 0);
  await rm(site, { recursive: true, force: true });
  console.log('Claricia na base: sentido entra no contexto; falha da base não afeta a resposta.');
}
