// Static, bounded reader. It never executes product code.
import { tokens } from './csharp-endpoints.mjs';
export const MAX_CALL_DEPTH = 3;
export const MAX_CALL_METHODS = 12;

function maskCsharp(source) {
  const chars = [...source];
  const hide = (from, to) => { for (let at = from; at < to; at++) if (chars[at] !== '\n') chars[at] = ' '; };
  for (let i = 0; i < source.length;) {
    const start = i;
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i + 2); if (i < 0) i = source.length; hide(start, i); continue; }
    if (source.startsWith('/*', i)) { i = source.indexOf('*/', i + 2); i = i < 0 ? source.length : i + 2; hide(start, i); continue; }
    const prefix = source.slice(i).match(/^(?:\$@|@\$|\$|@)?("{3,}|"|')/u);
    if (!prefix) { i++; continue; }
    const marker = prefix[1], verbatim = prefix[0].includes('@');
    i += prefix[0].length;
    while (i < source.length) {
      if (source.startsWith(marker, i)) {
        if (verbatim && marker === '"' && source[i + 1] === '"') { i += 2; continue; }
        i += marker.length; break;
      }
      if (!verbatim && source[i] === '\\') i += 2;
      else i++;
    }
    hide(start, i);
  }
  return chars.join('');
}

function blockEnd(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}
const lineOf = (source, at) => source.slice(0, at).split('\n').length;

function declarations(source, path) {
  const clean = maskCsharp(source);
  const lex = tokens(source);
  const classes = [];
  for (let i = 0; i < lex.length; i++) {
    if (lex[i].value !== 'class' || lex[i + 1]?.kind !== 'word') continue;
    const name = lex[i + 1].value, bases = [];
    let j = i + 2, angle = 0, base = null, inBases = false;
    while (j < lex.length && lex[j].value !== '{' && lex[j].value !== ';') {
      const item = lex[j];
      if (item.value === 'where' && angle === 0) break;
      if (item.value === ':' && !inBases) inBases = true;
      else if (inBases && item.value === '<') angle++;
      else if (inBases && item.value === '>') angle--;
      else if (inBases && item.value === ',' && angle === 0) { if (base) bases.push(base); base = null; }
      else if (inBases && item.kind === 'word' && angle === 0 && !base) base = item.value;
      j++;
    }
    if (base) bases.push(base);
    while (j < lex.length && lex[j].value !== '{' && lex[j].value !== ';') j++;
    if (lex[j]?.value === '{') classes.push({ name, interfaces: bases, path, start: lex[i].at,
      end: blockEnd(clean, lex[j].at) });
  }
  const fields = new Map([...clean.matchAll(/\b(?:private|protected|public)\s+(?:readonly\s+)?(\w+)\s+(_\w+)\s*;/gu)]
    .map((match) => [match[2], match[1]]));
  for (const match of clean.matchAll(/\b(?:public|internal)\s+\w+\s*\(([^)]*)\)\s*\{([^{}]*)\}/gu)) {
    const args = new Map([...match[1].matchAll(/\b(\w+)\s+(\w+)\b/gu)].map((arg) => [arg[2], arg[1]]));
    for (const assignment of match[2].matchAll(/\b(_\w+)\s*=\s*(\w+)\s*;/gu))
      if (args.has(assignment[2])) fields.set(assignment[1], args.get(assignment[2]));
  }
  const methods = [];
  for (let i = 0; i < lex.length; i++) {
    if (!['public', 'protected', 'internal', 'private'].includes(lex[i].value)) continue;
    let open = i + 1, close;
    while (open < lex.length && ![';', '{', '='].includes(lex[open].value)) {
      if (lex[open].value === '(' && lex[open - 1]?.kind === 'word') {
        close = open + 1;
        let depth = 1;
        while (close < lex.length && depth) {
          if (lex[close].value === '(') depth++;
          if (lex[close].value === ')') depth--;
          close++;
        }
        if (lex[close]?.value === '{') break;
        open = close;
      } else open++;
    }
    if (lex[open]?.value !== '(' || lex[close]?.value !== '{') continue;
    const method = lex[open - 1].value;
    const brace = lex[close].at, end = blockEnd(clean, brace), start = lex[i].at;
    const owners = classes.filter((cls) => cls.start < start && end <= cls.end);
    if (!owners.length) continue;
    methods.push({ method, path, start: lineOf(source, start), end: lineOf(source, end - 1),
      body: clean.slice(brace, end), excerpt: source.slice(start, end), fields, classes: owners });
  }
  return { classes, methods };
}

export function traceCsharpCalls(sources, paths, endpoint) {
  const allowed = paths.filter((path) => /\.cs$/u.test(path) && !/(?:^|\/)(?:Migrations?|appsettings[^/]*)(?:\/|$)/iu.test(path)
    && !/(?:connection|credential|secret|config)/iu.test(path));
  const declarationsByPath = allowed.map((path) => declarations(sources[path] ?? '', path));
  const index = declarationsByPath.flatMap((item) => item.methods);
  const declaredClasses = new Set(declarationsByPath.flatMap((item) => item.classes.map((cls) => cls.name)));
  const controller = index.find((item) => item.path === endpoint.file && item.method === endpoint.method);
  const methods = [], pending = [], seen = new Set(), neededTypes = new Set();
  function calls(body) {
    const lex = tokens(body), result = [];
    for (let i = 0; i < lex.length - 3; i++) {
      if (lex[i].kind === 'word' && lex[i + 1].value === '.' && lex[i + 2].kind === 'word'
        && lex[i + 3].value === '(' && lex[i - 1]?.value !== '.')
        result.push({ receiver: lex[i].value, name: lex[i + 2].value });
    }
    return result;
  }
  function visit(parent, depth) {
    if (!parent) return;
    if (depth >= MAX_CALL_DEPTH) {
      if (calls(parent.body).some(({ receiver }) => receiver.startsWith('_') || declaredClasses.has(receiver)))
        pending.push(`limite de profundidade: ${MAX_CALL_DEPTH}`);
      return;
    }
    if (methods.length >= MAX_CALL_METHODS) return;
    for (const call of calls(parent.body)) {
      const fieldType = parent.fields.get(call.receiver);
      const staticType = declaredClasses.has(call.receiver) || /^[A-Z]/u.test(call.receiver) ? call.receiver : null;
      if (!fieldType && !staticType) continue;
      if (fieldType) neededTypes.add(fieldType);
      if (staticType) neededTypes.add(staticType);
      const candidates = index.filter((item) => item.method === call.name && item.classes.some((cls) =>
        cls.name === (fieldType ?? staticType) || (fieldType && cls.interfaces.includes(fieldType))));
      if (candidates.length > 1) { pending.push(`chamada ambígua: ${call.name}`); continue; }
      const method = candidates[0];
      if (!method) { pending.push(`chamada não resolvida: ${call.name}`); continue; }
      if (seen.has(`${method.path}:${method.start}:${method.method}`)) continue;
      seen.add(`${method.path}:${method.start}:${method.method}`);
      if (methods.length >= MAX_CALL_METHODS) { pending.push(`limite de métodos: ${MAX_CALL_METHODS}`); break; }
      methods.push({ method: method.method, path: method.path, start: method.start, end: method.end,
        excerpt: method.excerpt, depth: depth + 1 });
      visit(method, depth + 1);
    }
  }
  visit(controller, 0);
  return { methods, pending: [...new Set(pending)], neededTypes: [...neededTypes] };
}
