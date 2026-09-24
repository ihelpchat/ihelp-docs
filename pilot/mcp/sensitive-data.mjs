const EMAIL = String.raw`\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`;
const CPF = String.raw`\b\d{3}\.\d{3}\.\d{3}-\d{2}\b`;
const PHONE = String.raw`(?<![\d\w])(?:\+?55[\s().-]*)?\(?\d{2}\)?[\s().-]*9?\d{4}[\s.-]*\d{4}\b`;
const PERSONAL_DATA = new RegExp(`${EMAIL}|${CPF}|${PHONE}`, 'giu');

export function containsPersonalData(value) {
  return new RegExp(PERSONAL_DATA.source, 'iu').test(String(value ?? ''));
}

export function redactPersonalData(value) {
  return String(value ?? '').replace(new RegExp(PERSONAL_DATA.source, 'giu'), '[dado removido]');
}
