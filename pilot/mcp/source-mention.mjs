// Um único critério para toda prosa que pode chegar ao site ou à Claricia.
const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
const fileName = /(?:^|[^a-z0-9_-])[a-z0-9_-]+\.md(?:$|[^a-z0-9_-])/u;
const namedSource = /\b(?:contexto de negocio|business-context|segundo cerebro)\b/u;
const attribution = /\b(?:segundo|conforme|de acordo com|com base (?:em|no|na|nos|nas)|a partir (?:de|do|da|dos|das)|pelo que consta em|como (?:indicado|descrito|mencionado) em)\b/gu;
const material = /^(?:conteudo|texto|material|documento|documentacao|fonte|contexto|informacoes|dados|base|referencia|arquivo|trecho|descricao|anotacoes|fornecido|disponibilizado|recebido|informado|apresentado|enviado|consultado)$/u;
const generation = /\b(?:nao ha informac(?:ao|oes) sobre|as informacoes disponiveis|nao foi informado)\b/u;

export function mentionsSource(value) {
  const text = fold(value);
  if (fileName.test(text) || namedSource.test(text) || generation.test(text)) return true;
  for (const match of text.matchAll(attribution)) {
    const words = text.slice(match.index + match[0].length).split(/[.!?;:,\n]/u, 1)[0]
      .match(/[a-z]+/gu)?.slice(0, 5) ?? [];
    if (words.some((word) => material.test(word))) return true;
  }
  return false;
}
