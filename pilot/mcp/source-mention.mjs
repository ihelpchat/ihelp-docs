// Um único critério para toda prosa que pode chegar ao site ou à Claricia.
const phrases = [
  'segundo o contexto', 'de acordo com o contexto', 'conforme o contexto',
  'contexto de negocio', 'business-context', 'segundo cerebro',
  'segundo o material', 'segundo a fonte', 'conforme a documentacao interna',
];
const fold = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
const fileName = /(?:^|[^a-z0-9_-])[a-z0-9_-]+\.md(?:$|[^a-z0-9_-])/u;

export function mentionsSource(value) {
  const text = fold(value);
  return phrases.some((phrase) => text.includes(phrase)) || fileName.test(text);
}
