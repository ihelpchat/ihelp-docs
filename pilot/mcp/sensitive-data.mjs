const PERSONAL = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/u,
  /(?<!\d)(?:\+?55[\s().-]*)?\(?\d{2}\)?[\s().-]*9?\d{4}[\s.-]*\d{4}(?!\d)/u,
  /(?<!\d)\d{10,11}(?!\d)/u,
];

const CREDENTIALS = [
  /(?:Authorization:\s*)?Bearer\s+[A-Za-z0-9._~+/-]{12,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/iu,
  /(?<![A-Za-z0-9])(?:sk|gh[pousr]|github_pat)_[A-Za-z0-9_-]{20,}/iu,
  /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{30,}/u,
];
const CREDENTIAL_PAIR = /(?<![\p{L}\p{N}_])(["']?)((?:[A-Za-z_][A-Za-z0-9_-]*?)?(?:api[_-]?key|password|senha|secret|token))\1\s*[:=]\s*(?:"[^"\n]+"|'[^'\n]+'|[^\s,;}\]]+)/giu;
const CREDENTIAL_KEY = /(?:api[_-]?key|password|senha|secret|token)$/iu;
const PLACEHOLDER = /^(?:\$[A-Z_][A-Z0-9_]*|\$\{[A-Z_][A-Z0-9_]*\}|null|true|false|undefined|string|number|[A-Z_]+)$/u;

function credentialPairs(value) {
  return [...String(value ?? '').matchAll(CREDENTIAL_PAIR)].filter(([pair, , key]) => {
    if (!CREDENTIAL_KEY.test(key)) return false;
    const raw = pair.replace(/^.*?[:=]\s*/u, '').replace(/^["']|["']$/gu, '');
    return raw.length >= 6 && !PLACEHOLDER.test(raw);
  });
}

function matchesAny(value, patterns) {
  const text = String(value ?? '');
  return patterns.some((pattern) => pattern.test(text));
}

function redact(value, patterns, marker) {
  return patterns.reduce((text, pattern) => text.replace(new RegExp(pattern.source, `${pattern.flags}g`), marker), String(value ?? ''));
}

export function sensitiveKinds(value) {
  return { personal: matchesAny(value, PERSONAL), credential: matchesAny(value, CREDENTIALS) || credentialPairs(value).length > 0 };
}

export function containsSensitiveData(value) {
  const kinds = sensitiveKinds(value);
  return kinds.personal || kinds.credential;
}

export function redactSensitiveData(value) {
  const pairs = new Set(credentialPairs(value).map(([pair]) => pair));
  const withoutPairs = String(value ?? '').replace(CREDENTIAL_PAIR, (pair) => pairs.has(pair) ? '[segredo removido]' : pair);
  return redact(redact(withoutPairs, CREDENTIALS, '[segredo removido]'), PERSONAL, '[dado removido]');
}

export function containsPersonalData(value) {
  return sensitiveKinds(value).personal;
}

export function redactPersonalData(value) {
  return redact(value, PERSONAL, '[dado removido]');
}
