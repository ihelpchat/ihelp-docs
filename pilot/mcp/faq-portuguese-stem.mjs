// Radical leve, apenas para cobertura lexical. Não altera texto nem citações.
// 1. Dobra plural regular e feminino; 2. remove sufixos verbais comuns,
//    preferindo os mais longos; 3. dobra vogal final de tema e da flexão.
// Nunca use este radical para validar quote literal ou rótulo da tela.
const fold = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
const suffixes = [
  'ariam', 'eriam', 'iriam', 'assem', 'essem', 'issem', 'ando', 'endo', 'indo',
  'aram', 'eram', 'iram', 'avam', 'aria', 'eria', 'iria', 'arao', 'erao', 'irao',
  'ados', 'idos', 'adas', 'idas', 'ado', 'ido', 'ada', 'ida',
  'ara', 'era', 'ira', 'ava', 'iam', 'amos', 'emos', 'imos',
  'ar', 'er', 'ir', 'ou', 'ei', 'am', 'em', 'ia',
];

export function faqStem(value) {
  let word = fold(value);
  if (word.endsWith('oes') || word.endsWith('aes')) word = `${word.slice(0, -3)}ao`;
  else if (word.endsWith('ais')) word = `${word.slice(0, -3)}al`;
  else if (word.endsWith('eis')) word = `${word.slice(0, -3)}el`;
  else if (word.length > 3 && word.endsWith('s')) word = word.slice(0, -1);
  for (const suffix of suffixes) if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
    word = word.slice(0, -suffix.length); break;
  }
  if (word.length > 4 && /[aeoi]$/u.test(word)) word = word.slice(0, -1);
  return word;
}
