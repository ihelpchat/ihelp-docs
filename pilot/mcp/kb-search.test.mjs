import assert from 'node:assert/strict';
import { chunkArticle, makeChunk, plainFromMdx, splitLong, splitSections } from './kb-chunk.mjs';
import { createSearch, pagesOf, stem, tokenize } from './kb-search.mjs';

// --- corte de páginas ---
const body = 'Abertura da página.\n\n## Como importar\n\n1. Abra **Contatos**.\n\n<Callout>Atenção</Callout>\n\n```\n## não é heading\n```\n\n## Dúvidas comuns\n\nTexto.';
const sections = splitSections(body);
assert.deepEqual(sections.map(({ heading }) => heading), [null, 'Como importar', 'Dúvidas comuns'], 'heading dentro de bloco de código não corta');
assert.equal(plainFromMdx('Veja [o guia](/docs/x) e ![print](/img/a.png) <Callout type="warn">**Cuidado**</Callout>'), 'Veja o guia e Cuidado');

const chunks = chunkArticle({ path: '/docs/contatos/importar', title: 'Importar contatos', description: 'Traga sua lista.', body });
assert.equal(chunks.length, 3);
assert.equal(chunks[0].ref.path, 'docs/contatos/importar');
assert.equal(chunks[1].title, 'Importar contatos › Como importar');
assert.equal(chunks[1].ref.anchor, '#como-importar');
assert.ok(chunks.every(({ source, visibility }) => source === 'faq' && visibility === 'publica'));
assert.equal(chunks[0].id, chunkArticle({ path: '/docs/contatos/importar', title: 'Importar contatos', description: 'Traga sua lista.', body })[0].id, 'id estável');
assert.equal(makeChunk({ source: 'negocio', title: 'x', text: 'y' }).visibility, 'interna');
assert.equal(chunkArticle({ path: 'api/crm/funis', title: 'Funis', body: 'Lista funis.' })[0].source, 'api', 'referência da API não se mistura ao FAQ');
assert.throws(() => makeChunk({ source: 'outro', title: 'x', text: 'y' }), /source inválido/);
assert.ok(splitLong(`${'Frase curta. '.repeat(200)}`).every((part) => part.length <= 1_200));

// --- busca por palavra ---
assert.deepEqual(tokenize('Como eu faço pra importar os contatos?'), ['faco', 'importar', 'contatos']);
assert.equal(stem('campanhas'), stem('campanha'));

const page = (path, title, text, source = 'faq') => makeChunk({ source, title, text, ref: { path } });
const index = { version: 'v1', chunks: [
  page('docs/contatos/importar', 'Importar contatos', 'Envie uma planilha para trazer sua lista de clientes.'),
  page('docs/contatos/exportar', 'Exportar contatos do celular', 'Baixe a agenda do aparelho. Depois você pode importar a planilha.'),
  page('docs/campanhas/criar', 'Como criar uma nova campanha', 'Dispare mensagens em massa para uma lista.'),
  page('docs/canais/qr', 'Reconectar canal por QR Code', 'Leia o código com o celular para voltar a atender.'),
  page('interno/negocio', 'Risco de bloqueio', 'Canal por QR é mais suscetível a bloqueio em disparo em massa.', 'negocio'),
] };

const lexicalOnly = createSearch(index);
const importar = await lexicalOnly({ query: 'importar contatos' });
assert.equal(importar.degraded, true);
assert.equal(importar.hits[0].chunk.ref.path, 'docs/contatos/importar', 'título completo ganha de menção no corpo');
assert.equal(importar.hits[0].why, 'palavra');

const publico = await lexicalOnly({ query: 'bloqueio', visibility: 'publica' });
assert.ok(publico.hits.every(({ chunk }) => chunk.visibility === 'publica'), 'Claricia nunca vê fonte interna');
const interno = await lexicalOnly({ query: 'bloqueio', visibility: 'interna' });
assert.equal(interno.hits[0].chunk.source, 'negocio');
assert.equal((await lexicalOnly({ query: 'bloqueio', sources: ['faq'] })).hits.length, 0);
await assert.rejects(() => lexicalOnly({ query: 'a' }), /ao menos 2/);

// --- busca por sentido (vetores de brinquedo: cada eixo é um assunto) ---
const vectors = [[1, 0, 0, 0], [0.6, 0.4, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 0.5, 0.8]];
const sense = { 'trazer minha lista de clientes': [1, 0, 0, 0], 'meu numero caiu': [0, 0, 0, 1] };
const hybrid = createSearch({ ...index, vectors }, { embedQuery: async (text) => sense[text] ?? null });

const semPalavra = await hybrid({ query: 'meu numero caiu', visibility: 'publica' });
assert.equal(semPalavra.degraded, false);
assert.equal(semPalavra.hits[0].chunk.ref.path, 'docs/canais/qr', 'acha por sentido mesmo sem palavra em comum');
assert.equal(semPalavra.hits[0].why, 'sentido');

const ambos = await hybrid({ query: 'trazer minha lista de clientes' });
assert.equal(ambos.hits[0].chunk.ref.path, 'docs/contatos/importar');
assert.equal(ambos.hits[0].why, 'ambos');

// provedor fora do ar: continua por palavra e avisa
const fora = createSearch({ ...index, vectors }, { embedQuery: async () => { throw new Error('timeout'); } });
const caiu = await fora({ query: 'importar contatos' });
assert.equal(caiu.degraded, true);
assert.equal(caiu.hits[0].chunk.ref.path, 'docs/contatos/importar');

assert.deepEqual(pagesOf(importar.hits).map(({ path }) => path).slice(0, 2), ['docs/contatos/importar', 'docs/contatos/exportar']);

console.log('base de conhecimento: corte, busca por palavra, por sentido, filtro de visibilidade e modo degradado.');

// --- embedder com cliente simulado: ordem preservada, cache de pergunta, trava de volume ---
{
  const { createEmbedder } = await import('./kb-embed.mjs');
  let calls = 0;
  const client = { embeddings: { create: async ({ input }) => { calls++;
    return { usage: { total_tokens: input.length * 3 }, data: input.map((text, index) => ({ index, embedding: [text.length] })).reverse() }; } } };
  const embedder = await createEmbedder({ client, maxInputs: 4 });
  assert.deepEqual(await embedder.embed(['a', 'bbb']), [[1], [3]], 'devolve na ordem pedida');
  await embedder.embedQuery('Oi'); await embedder.embedQuery('oi ');
  assert.equal(calls, 2, 'pergunta repetida não paga de novo');
  assert.equal(embedder.usage().tokens, 9);
  await assert.rejects(() => embedder.embed(['x', 'y']), /limite de 4/);
  console.log('embedder: ordem, cache e trava de volume.');
}
