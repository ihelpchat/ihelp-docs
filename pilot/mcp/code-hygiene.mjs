import { containsSensitiveData } from './sensitive-data.mjs';

const ROUTE = /^(?:\/|api\/)[A-Za-z0-9/_{}:?.*-]*$/u;
const SQL = /^(?:SELECT|FROM|WHERE|AND|OR|ORDER|GROUP|INNER|LEFT|RIGHT|JOIN|LIMIT|OFFSET|INSERT|UPDATE|DELETE|SET|VALUES|COUNT|AS|ON|CASE|WHEN)\b|^\(/iu;
const SIMPLE = /^[\p{L}\p{N} .,;:!?()'_-]{1,200}$/u;
const MARKER = '"<literal omitido>"';

function permitted(value) {
  if (ROUTE.test(value)) return true;
  if (SQL.test(value.trim()) && !value.includes('://') && !containsSensitiveData(value)) return true;
  const longWords = value.match(/[\p{L}\p{N}]{20,}/gu) ?? [];
  return SIMPLE.test(value) && !value.includes('://') && !value.includes('@') && !value.includes('=')
    && !longWords.some((word) => /\p{L}/u.test(word) && /\p{N}/u.test(word));
}

function permittedInterpolated(value) {
  const expressions = [...value.matchAll(/\{([^{}]*)\}/gu)];
  if (!expressions.length || expressions.some((match) => !/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(match[1]))) return false;
  const parts = value.split(/\{[^{}]*\}/gu);
  if (parts.some((part) => part && !permitted(part))) return false;
  return !/[{}]/u.test(value.replace(/\{[^{}]*\}/gu, ''));
}

export function sanitizeCodeForModel(source) {
  const input = String(source ?? '');
  const counts = { literalsOmitted: 0, commentsRemoved: 0 };
  let i = 0;
  let output = '';
  while (i < input.length) {
    if (input.startsWith('///', i)) {
      const end = input.indexOf('\n', i);
      const stop = end < 0 ? input.length : end;
      const plain = input.slice(i + 3, stop).replace(/<[^>]*>/gu, '').trim();
      if (permitted(plain)) output += `/// ${plain}`;
      else counts.commentsRemoved++;
      i = stop;
      continue;
    }
    if (input.startsWith('//', i)) {
      const end = input.indexOf('\n', i);
      i = end < 0 ? input.length : end;
      counts.commentsRemoved++;
      continue;
    }
    if (input.startsWith('/*', i)) {
      const end = input.indexOf('*/', i + 2);
      const stop = end < 0 ? input.length : end + 2;
      output += (input.slice(i, stop).match(/\n/gu) ?? []).join('');
      i = stop;
      counts.commentsRemoved++;
      continue;
    }
    let prefix = '';
    if (input[i] === '@' || input[i] === '$') {
      if ((input[i + 1] === '@' || input[i + 1] === '$') && input[i + 2] === '"') prefix = input.slice(i, i + 2);
      else if (input[i + 1] === '"') prefix = input[i];
    }
    const quoteAt = i + prefix.length;
    if (input[quoteAt] === '"' || (input[quoteAt] === "'" && !prefix)) {
      const quote = input[quoteAt], verbatim = prefix.includes('@'), interpolated = prefix.includes('$');
      let end = quoteAt + 1, value = '', closed = false;
      for (; end < input.length; end++) {
        const char = input[end];
        if (interpolated && char === '{' && input[end + 1] !== '{') {
          let depth = 1;
          const start = end;
          while (++end < input.length && depth) {
            if (input[end] === '"' || input[end] === "'") {
              const nested = input[end++];
              while (end < input.length && input[end] !== nested) {
                if (input[end] === '\\') end++;
                end++;
              }
            } else if (input[end] === '{') depth++;
            else if (input[end] === '}') depth--;
          }
          value += input.slice(start, end);
          end--;
          continue;
        }
        if (verbatim && char === '"' && input[end + 1] === '"') { value += '"'; end++; continue; }
        if (!verbatim && char === '\\' && end + 1 < input.length) { value += input[end + 1]; end++; continue; }
        if (char === quote) { closed = true; end++; break; }
        value += char;
      }
      if (!closed || !(interpolated ? permittedInterpolated(value) : permitted(value))) {
        output += MARKER + (input.slice(i, end).match(/\n/gu) ?? []).join('');
        counts.literalsOmitted++;
      }
      else output += input.slice(i, end);
      i = end;
      continue;
    }
    output += input[i++];
  }
  return { text: output, ...counts };
}
