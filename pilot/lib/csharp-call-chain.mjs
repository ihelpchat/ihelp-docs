// Static, bounded reader. It never executes product code.
import { tokens, neutralizeCsharp, resolveCsharpAction } from './csharp-endpoints.mjs';
export const MAX_CALL_DEPTH = 3;
export const MAX_CALL_METHODS = 12;

function blockEnd(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}
const lineOf = (source, at) => source.slice(0, at).split('\n').length;
function simpleType(type) {
  const value = String(type ?? '').replace(/\s|\?/gu, '');
  if (/^(?:List|IEnumerable)<|\[\]$/u.test(value)) return 'list';
  if (/^string$/iu.test(value)) return 'string';
  if (/^(?:int|long|short|double|decimal|float)$/iu.test(value)) return 'number';
  if (/^bool$/iu.test(value)) return 'boolean';
  return null;
}
function declaredType(text, name) {
  const declarations = [...text.matchAll(/\b((?:List|IEnumerable)\s*<[^>]+>|[A-Za-z_]\w*(?:\[\])?)\s+([A-Za-z_]\w*)\s*(?:[,)=;]|$)/gu)];
  return simpleType(declarations.filter((match) => match[2] === name).at(-1)?.[1]);
}

function declarations(source, path) {
  const clean = neutralizeCsharp(source);
  const lex = tokens(clean);
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
    methods.push({ method, path, start: lineOf(source, start), methodAt: lex[open - 1].at, end: lineOf(source, end - 1),
      body: clean.slice(brace, end), excerpt: source.slice(start, end), fields, classes: owners,
      parameters: clean.slice(lex[open].at + 1, lex[close - 1].at),
      returnType: clean.slice(start, lex[open - 1].at).trim()
        .replace(/^(?:(?:public|protected|internal|private|static|async|virtual|override)\s+)*/u, '')
        .replace(/\s+/gu, '') });
  }
  return { classes, methods };
}

export function traceCsharpCalls(sources, paths, endpoint) {
  const allowed = paths.filter((path) => /\.cs$/u.test(path) && !/(?:^|\/)(?:Migrations?|appsettings[^/]*)(?:\/|$)/iu.test(path)
    && !/(?:connection|credential|secret|config)/iu.test(path));
  const declarationsByPath = allowed.map((path) => declarations(sources[path] ?? '', path));
  const index = declarationsByPath.flatMap((item) => item.methods);
  const declaredClasses = new Set(declarationsByPath.flatMap((item) => item.classes.map((cls) => cls.name)));
  const action = resolveCsharpAction(sources[endpoint.file] ?? '', endpoint.file, endpoint);
  const controller = action && index.find((item) => item.path === endpoint.file
    && item.methodAt === action.actionAt && item.method === action.method);
  const methods = [], pending = [], seen = new Set(), neededTypes = new Set();
  function calls(body) {
    const lex = tokens(body), result = [];
    for (let i = 0; i < lex.length - 3; i++) {
      if (lex[i].kind === 'word' && lex[i + 1].value === '.' && lex[i + 2].kind === 'word'
        && lex[i + 3].value === '(' && lex[i - 1]?.value !== '.') {
        const args = [];
        let depth = 1, start = i + 4, j = start;
        for (; j < lex.length && depth; j++) {
          if (lex[j].value === '(') depth++;
          else if (lex[j].value === ')') {
            depth--;
            if (!depth) {
              if (j > start) args.push(lex.slice(start, j).map((token) => token.value).join(''));
              break;
            }
          } else if (lex[j].value === ',' && depth === 1) {
            args.push(lex.slice(start, j).map((token) => token.value).join(''));
            start = j + 1;
          }
        }
        result.push({ receiver: lex[i].value, name: lex[i + 2].value, args });
      }
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
      let candidates = index.filter((item) => item.method === call.name && item.classes.some((cls) =>
        cls.name === (fieldType ?? staticType) || (fieldType && cls.interfaces.includes(fieldType))));
      candidates = candidates.filter((item) => (item.parameters.trim() ? item.parameters.split(',').length : 0) === call.args.length);
      for (let i = 0; i < call.args.length; i++) {
        const arg = call.args[i];
        const localCall = /^([A-Za-z_]\w*)\(\)$/u.exec(arg);
        const localReturns = localCall ? index.filter((item) => item.path === parent.path
          && item.method === localCall[1] && !item.parameters.trim()
          && item.classes.some((cls) => parent.classes.some((owner) => owner.name === cls.name))) : [];
        const known = /^-?\d+(?:\.\d+)?$/u.test(arg) ? 'number' : /^(?:true|false)$/u.test(arg) ? 'boolean'
          : /^[A-Za-z_]\w*$/u.test(arg) ? declaredType(parent.parameters + '; ' + parent.body, arg)
            : localReturns.length === 1 ? simpleType(localReturns[0].returnType) : null;
        if (known) candidates = candidates.filter((item) => {
          const parameter = item.parameters.split(',')[i]?.trim().replace(/\s+[A-Za-z_]\w*$/u, '');
          return simpleType(parameter) === known;
        });
      }
      if (candidates.length > 1) {
        const owner = candidates[0].classes.at(-1)?.name;
        pending.push(candidates.every((item) => item.classes.at(-1)?.name === owner)
          ? `sobrecarga ambígua: ${owner}.${call.name}: erros e cadeia não verificados`
          : `chamada ambígua: ${call.name}`);
        continue;
      }
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
  return { action: controller && { method: controller.method, path: controller.path, start: controller.start,
    end: controller.end, excerpt: controller.excerpt, depth: 0 },
  methods, pending: [...new Set(pending)], neededTypes: [...neededTypes] };
}
