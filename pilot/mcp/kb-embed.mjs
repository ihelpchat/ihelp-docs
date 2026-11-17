// Vetores de sentido para a base de conhecimento. O cliente é injetável para os testes não chamarem o provedor.
// Custo: text-embedding-3-small cobra por token de entrada; o índice inteiro do FAQ fica na casa de centavos.

const MODEL = () => process.env.KB_EMBEDDING_MODEL || 'text-embedding-3-small';
const MAX_INPUTS = () => Number(process.env.KB_EMBEDDING_MAX_INPUTS || 5_000);

export async function createEmbedder({ client, model = MODEL(), maxInputs = MAX_INPUTS() } = {}) {
  const api = client ?? new (await import('openai')).default();
  let used = 0;
  let tokens = 0;

  const embed = async (texts) => {
    if (!Array.isArray(texts) || !texts.length) return [];
    used += texts.length;
    // Trava simples contra laço que reindexa sem parar.
    if (used > maxInputs) throw new Error(`embeddings: limite de ${maxInputs} textos por execução`);
    const response = await api.embeddings.create({ model, input: texts, encoding_format: 'float' });
    tokens += response.usage?.total_tokens ?? 0;
    const sorted = [...response.data].sort((left, right) => left.index - right.index);
    if (sorted.length !== texts.length) throw new Error('embeddings: resposta incompleta');
    return sorted.map(({ embedding }) => embedding);
  };

  const cache = new Map();
  const embedQuery = async (text) => {
    const key = text.trim().toLocaleLowerCase('pt-BR');
    if (!cache.has(key)) cache.set(key, (await embed([text]))[0]);
    return cache.get(key);
  };

  return { embed, embedQuery, model, usage: () => ({ inputs: used, tokens }) };
}
