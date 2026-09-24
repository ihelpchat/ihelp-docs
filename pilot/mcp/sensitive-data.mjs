const PERSONAL = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/u,
  /(?<!\d)(?:\+?55[\s().-]*)?\(?\d{2}\)?[\s().-]*9?\d{4}[\s.-]*\d{4}(?!\d)/u,
  /(?<!\d)\d{10,11}(?!\d)/u,
];

const CREDENTIALS = [
  /(?:Authorization:\s*)?Bearer\s+[A-Za-z0-9._~+/-]{12,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /(?:apiKey|password|secret|token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}/iu,
  /(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/iu,
  /(?<![A-Za-z0-9])(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}/iu,
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/u,
];

function matchesAny(value, patterns) {
  const text = String(value ?? '');
  return patterns.some((pattern) => pattern.test(text));
}

function redact(value, patterns, marker) {
  return patterns.reduce((text, pattern) => text.replace(new RegExp(pattern.source, `${pattern.flags}g`), marker), String(value ?? ''));
}

export function sensitiveKinds(value) {
  return { personal: matchesAny(value, PERSONAL), credential: matchesAny(value, CREDENTIALS) };
}

export function containsSensitiveData(value) {
  const kinds = sensitiveKinds(value);
  return kinds.personal || kinds.credential;
}

export function redactSensitiveData(value) {
  return redact(redact(value, CREDENTIALS, '[segredo removido]'), PERSONAL, '[dado removido]');
}

export function containsPersonalData(value) {
  return sensitiveKinds(value).personal;
}

export function redactPersonalData(value) {
  return redact(value, PERSONAL, '[dado removido]');
}
