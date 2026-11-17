import { normalizeText } from './kb-chunk.mjs';

// Busca híbrida da base de conhecimento: palavra (BM25) + sentido (cosseno), unidas por RRF.
// Sem vetores (índice sem embeddings ou provedor fora) a busca continua só por palavra: degraded=true.

const STOPWORDS = new Set(['a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'e', 'ou', 'em',
  'no', 'na', 'nos', 'nas', 'para', 'pra', 'por', 'com', 'sem', 'que', 'se', 'como', 'eu', 'me', 'meu', 'minha',
  'ao', 'aos', 'mais', 'mas', 'nao', 'ja', 'esta', 'esta', 'ta', 'to', 'tem', 'ter', 'ser', 'foi', 'vai', 'isso',
  'esse', 'essa', 'este', 'qual', 'quais', 'onde', 'quando', 'sobre', 'pelo', 'pela', 'the']);

export function tokenize(text) {
  return normalizeText(text).split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

// Radical simples do português: plural e gênero. Basta para casar "campanhas" com "campanha".
export const stem = (word) => word.length > 4 ? word.replace(/(oes|aes|ais|eis|ns)$/, '').replace(/(es|s)$/, '').replace(/[ao]$/, '') : word;

const terms = (text) => tokenize(text).map(stem);

export function buildLexical(chunks) {
  const docs = chunks.map((chunk) => {
    const counts = new Map();
    const title = terms(chunk.title);
    // Título pesa 3x: é o melhor sinal de assunto.
    for (const term of [...title, ...title, ...title, ...terms(chunk.text)]) counts.set(term, (counts.get(term) ?? 0) + 1);
    return { counts, length: [...counts.values()].reduce((total, value) => total + value, 0) };
  });
  const df = new Map();
  for (const { counts } of docs) for (const term of counts.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const average = docs.reduce((total, doc) => total + doc.length, 0) / Math.max(1, docs.length);
  return { docs, df, average, size: docs.length };
}

export function lexicalScores(lexical, query, k1 = 1.4, b = 0.75) {
  const queryTerms = [...new Set(terms(query))];
  return lexical.docs.map(({ counts, length }) => {
    let score = 0;
    for (const term of queryTerms) {
      const tf = counts.get(term);
      if (!tf) continue;
      const idf = Math.log(1 + (lexical.size - lexical.df.get(term) + 0.5) / (lexical.df.get(term) + 0.5));
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * length / lexical.average));
    }
    return score;
  });
}

export function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const ranked = (scores, floor) => scores.map((score, index) => ({ index, score }))
  .filter(({ score }) => score > floor).sort((left, right) => right.score - left.score);

// index: { version, chunks: KnowledgeChunk[], vectors?: (number[]|Float32Array|null)[] }
// embedQuery: async (texto) => vetor | null. Opcional.
export function createSearch(index, { embedQuery } = {}) {
  const lexical = buildLexical(index.chunks);
  const hasVectors = Array.isArray(index.vectors) && index.vectors.some(Boolean);

  return async function search({ query, sources, module, visibility, limit = 8 } = {}) {
    if (typeof query !== 'string' || query.trim().length < 2) throw new Error('query precisa ter ao menos 2 caracteres');
    const allowed = (chunk) => (!sources?.length || sources.includes(chunk.source))
      && (!visibility || visibility === 'interna' || chunk.visibility === 'publica')
      && (!module || !chunk.module || chunk.module === module);

    const byWord = ranked(lexicalScores(lexical, query), 0).filter(({ index: i }) => allowed(index.chunks[i]));

    let bySense = [];
    let degraded = true;
    if (hasVectors && embedQuery) {
      let vector = null;
      try { vector = await embedQuery(query); } catch { vector = null; }
      if (vector) {
        degraded = false;
        bySense = ranked(index.vectors.map((item) => item ? cosine(vector, item) : 0), 0.2)
          .filter(({ index: i }) => allowed(index.chunks[i]));
      }
    }

    // Reciprocal Rank Fusion: junta as duas listas sem depender da escala de cada nota.
    const fused = new Map();
    const add = (list, why) => list.slice(0, 50).forEach(({ index: i }, rank) => {
      const entry = fused.get(i) ?? { score: 0, why: new Set() };
      entry.score += 1 / (60 + rank); entry.why.add(why); fused.set(i, entry);
    });
    add(byWord, 'palavra'); add(bySense, 'sentido');

    const hits = [...fused.entries()].sort((left, right) => right[1].score - left[1].score).slice(0, limit)
      .map(([i, { score, why }]) => ({ chunk: index.chunks[i], score: Number(score.toFixed(5)),
        why: why.size === 2 ? 'ambos' : [...why][0] }));
    return { hits, indexVersion: index.version, degraded };
  };
}

// Páginas distintas na ordem dos trechos: é o que a triagem e a Claricia consomem.
export function pagesOf(hits) {
  const seen = new Set();
  return hits.filter(({ chunk }) => chunk.ref?.path && !seen.has(chunk.ref.path) && seen.add(chunk.ref.path))
    .map(({ chunk, score }) => ({ path: chunk.ref.path, title: chunk.title.split(' › ')[0], score }));
}
