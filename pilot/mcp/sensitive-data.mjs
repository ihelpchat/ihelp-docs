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
const CREDENTIAL_PAIR = /(?<![\p{L}\p{N}_])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*[:=]\s*("[^"\n]+"|'[^'\n]+'|[^\s,;}\]]+)/giu;
const STRONG_KEY_SEGMENTS = new Set(['api', 'auth', 'access', 'secret', 'private', 'credential']);
const CREDENTIAL_SEGMENTS = new Set(['token', 'secret', 'password', 'passwd', 'pwd', 'senha', 'pass', 'key', 'credential', 'credentials']);
const DESCRIPTIVE_SUFFIXES = new Set(['hint', 'description', 'count', 'name', 'label', 'type', 'enabled', 'example']);
const PLACEHOLDER = /^(?:\$[A-Z_][A-Z0-9_]*|\$\{[A-Z_][A-Z0-9_]*\})$/u;
const NON_SECRET_LITERAL = /^(?:null|true|false|undefined|string|number)$/iu;

function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function secretLike(value) {
  if (matchesAny(value, CREDENTIALS)) return true;
  if (/\s/u.test(value)) return false;
  const classes = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^A-Za-z0-9]/u].filter((pattern) => pattern.test(value)).length;
  return (value.length >= 8 && classes >= 3)
    || (value.length >= 20 && classes >= 2)
    || (value.length >= 24 && entropy(value) >= 3.7);
}

function credentialKeyStrength(key) {
  const words = key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLocaleLowerCase('en-US').split(/[_-]+/u).map((word) => word.replace(/\d+$/u, ''));
  const last = words.at(-1);
  if (DESCRIPTIVE_SUFFIXES.has(last)) return 'none';
  if (['token', 'secret', 'password', 'senha'].includes(last)) return words.length > 1 ? 'strong' : 'weak';
  if (last === 'pass') return words.length > 1 ? 'strong' : 'weak';
  if (last === 'credentials') return words.length > 1 ? 'strong' : 'weak';
  if (last === 'key') return words.slice(0, -1).some((word) => STRONG_KEY_SEGMENTS.has(word)) ? 'strong' : 'weak';
  const folded = words.join('');
  if (folded.endsWith('key') && [...STRONG_KEY_SEGMENTS].some((word) => folded.slice(0, -3).endsWith(word))) return 'strong';
  if (/(?:api[_-]?key|password|senha|secret|token)$/iu.test(key)) return 'strong';
  if (words.some((word) => CREDENTIAL_SEGMENTS.has(word))) return 'weak';
  if (/(?:passwd|pwd|credentials?)$/u.test(folded)) return 'weak';
  return 'none';
}

function credentialPairs(value) {
  const text = String(value ?? '');
  const pattern = new RegExp(CREDENTIAL_PAIR.source, CREDENTIAL_PAIR.flags);
  const matches = [];
  for (let match; (match = pattern.exec(text));) {
    const [pair, , key, rawValue] = match;
    const strength = credentialKeyStrength(key);
    if (strength === 'none') {
      pattern.lastIndex = match.index + pair.indexOf(rawValue);
      continue;
    }
    const raw = rawValue.replace(/^["']|["']$/gu, '');
    if (raw.length >= 6 && !PLACEHOLDER.test(raw) && !NON_SECRET_LITERAL.test(raw) && (strength === 'strong' || secretLike(raw))) {
      matches.push({ start: match.index, end: pattern.lastIndex });
    }
  }
  return matches;
}

function matchesAny(value, patterns) {
  const text = String(value ?? '');
  return patterns.some((pattern) => pattern.test(text));
}

function redact(value, patterns, marker) {
  return patterns.reduce((text, pattern) => text.replace(new RegExp(pattern.source, `${pattern.flags}g`), marker), String(value ?? ''));
}

export function sensitiveKinds(value) {
  const text = String(value ?? '');
  const folded = text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US');
  return {
    personal: matchesAny(text, PERSONAL),
    credential: matchesAny(text, CREDENTIALS) || credentialPairs(text).length > 0,
    internal: /🟡|🔴|\binterno\b|\bconfidencial\b/u.test(folded),
    control: /[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text),
  };
}

export function containsSensitiveData(value) {
  const kinds = sensitiveKinds(value);
  return kinds.personal || kinds.credential || kinds.internal || kinds.control;
}

export function redactSensitiveData(value) {
  const withoutPairs = credentialPairs(value).toReversed().reduce((text, { start, end }) =>
    `${text.slice(0, start)}[segredo removido]${text.slice(end)}`, String(value ?? ''));
  return redact(redact(withoutPairs, CREDENTIALS, '[segredo removido]'), PERSONAL, '[dado removido]');
}

export function containsPersonalData(value) {
  return sensitiveKinds(value).personal;
}

export function redactPersonalData(value) {
  return redact(value, PERSONAL, '[dado removido]');
}
