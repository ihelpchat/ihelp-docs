// Static, bounded reader. It never executes product code.
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
  const classes = [...clean.matchAll(/\bclass\s+(\w+)\s*(?::\s*([\w,\s]+))?\s*\{/gu)]
    .map((match) => ({ name: match[1], interfaces: (match[2] ?? '').split(',').map((name) => name.trim()), path,
      start: match.index, end: blockEnd(clean, match.index + match[0].lastIndexOf('{')) }));
  const fields = new Map([...clean.matchAll(/\b(?:private|protected|public)\s+(?:readonly\s+)?(\w+)\s+(_\w+)\s*;/gu)]
    .map((match) => [match[2], match[1]]));
  for (const match of clean.matchAll(/\b(?:public|internal)\s+\w+\s*\(([^)]*)\)\s*\{([^{}]*)\}/gu)) {
    const args = new Map([...match[1].matchAll(/\b(\w+)\s+(\w+)\b/gu)].map((arg) => [arg[2], arg[1]]));
    for (const assignment of match[2].matchAll(/\b(_\w+)\s*=\s*(\w+)\s*;/gu))
      if (args.has(assignment[2])) fields.set(assignment[1], args.get(assignment[2]));
  }
  const methods = [];
  for (const match of clean.matchAll(/\b(?:public|protected|internal)\s+(?:async\s+)?[\w<>?,\[\]\s]+?\s+(\w+)\s*\([^)]*\)\s*\{/gu)) {
    const brace = match.index + match[0].lastIndexOf('{');
    const end = blockEnd(clean, brace);
    methods.push({ method: match[1], path, start: lineOf(source, match.index), end: lineOf(source, end - 1),
      body: clean.slice(brace, end), excerpt: source.slice(match.index, end), fields,
      classes: classes.filter((cls) => cls.start < match.index && end <= cls.end) });
  }
  return { classes, methods };
}

export function traceCsharpCalls(sources, paths, endpoint) {
  const allowed = paths.filter((path) => /\.cs$/u.test(path) && !/(?:^|\/)(?:Migrations?|appsettings[^/]*)(?:\/|$)/iu.test(path)
    && !/(?:connection|credential|secret|config)/iu.test(path));
  const index = allowed.flatMap((path) => declarations(sources[path] ?? '', path).methods);
  const controller = index.find((item) => item.path === endpoint.file && item.method === endpoint.method);
  const methods = [], pending = [], seen = new Set(), neededTypes = new Set();
  function visit(parent, depth) {
    if (!parent) return;
    if (depth >= MAX_CALL_DEPTH) {
      if (/\b_\w+\.\w+\s*\(/u.test(parent.body)) pending.push(`limite de profundidade: ${MAX_CALL_DEPTH}`);
      return;
    }
    if (methods.length >= MAX_CALL_METHODS) return;
    for (const call of parent.body.matchAll(/\b(_\w+)\.(\w+)\s*\(/gu)) {
      const fieldType = parent.fields.get(call[1]);
      if (!fieldType) continue;
      neededTypes.add(fieldType);
      const candidates = index.filter((item) => item.method === call[2] && item.classes.some((cls) =>
        cls.name === fieldType || cls.interfaces.includes(fieldType)));
      if (candidates.length > 1) { pending.push(`chamada ambígua: ${call[2]}`); continue; }
      const method = candidates[0];
      if (!method || seen.has(`${method.path}:${method.start}:${method.method}`)) continue;
      seen.add(`${method.path}:${method.start}:${method.method}`);
      if (methods.length >= MAX_CALL_METHODS) { pending.push(`limite de métodos: ${MAX_CALL_METHODS}`); break; }
      methods.push({ method: method.method, path: method.path, start: method.start, end: method.end,
        excerpt: method.excerpt });
      visit(method, depth + 1);
    }
  }
  visit(controller, 0);
  return { methods, pending: [...new Set(pending)], neededTypes: [...neededTypes] };
}
