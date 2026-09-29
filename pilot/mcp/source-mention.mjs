// Um único critério para toda prosa que pode chegar ao site ou à Claricia.
const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
const fileName = /(?:^|[^a-z0-9_-])[a-z0-9_-]+\.md(?:$|[^a-z0-9_-])/u;
const namedSource = /\b(?:contexto de negocio|business-context|segundo cerebro)\b/u;
const attribution = /\b(?:segundo|conforme|de acordo com|com base (?:em|no|na|nos|nas)|a partir (?:de|do|da|dos|das)|pelo que consta em|como (?:indicado|descrito|mencionado) em)\b/gu;
const material = /^(?:informac|document|materi|conteud|text|font|context|dad|arquiv|trech|anotac|referenc|descric|leitur|fornec|disponibiliz|receb|inform|apresent|envi|consult|compartilh)[a-z]*$/u;
const generation = /\b(?:nao ha informac(?:ao|oes) sobre|nao foi informado)\b/u;
const available = /\b(?:informac(?:ao|oes)|dados|o que)\s+(?:est(?:a|ao)\s+)?disponive(?:l|is)\b/gu;
const productPlace = /\b(?:(?:na|no|nas|nos)\s+(?:ficha|contato|tela|modulo|ihelp|painel|atendimento|conversa)|(?:no|neste)\s+endpoint)\b/u;
const sourceMaterial = /^(?:document|materi|context|conteud|font|arquiv|bas|text|anotac|referenc)[a-z]*$/u;
const sourceVerb = /\b(?:indica[mr]?|mostra[mr]?|diz(?:em)?|aponta[mr]?)\s+que\b/u;

export function mentionsSource(value) {
  const text = fold(value);
  if (fileName.test(text) || namedSource.test(text) || generation.test(text)) return true;
  for (const match of text.matchAll(available)) {
    const clause = text.slice(match.index + match[0].length).split(/[.!?;\n]/u, 1)[0];
    const words = clause.match(/[a-z]+/gu) ?? [];
    if (words.some((word) => sourceMaterial.test(word)) || sourceVerb.test(clause)
      || !productPlace.test(clause)) return true;
  }
  for (const match of text.matchAll(attribution)) {
    const words = text.slice(match.index + match[0].length).split(/[.!?;:,\n]/u, 1)[0]
      .match(/[a-z]+/gu)?.slice(0, 5) ?? [];
    if (words.some((word, index) => material.test(word)
      && !(word === 'referencia' && words[index - 1] === 'de' && words[index - 2] === 'identificador'))) return true;
  }
  return false;
}
