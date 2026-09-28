// One position-preserving C# scan for attributes and structural analysis.
function scanCsharp(source) {
  const result = [];
  const chars = source.split('');
  const hide = (from, to) => { for (let at = from; at < to; at++) if (chars[at] !== '\n') chars[at] = ' '; };
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i);
    if (/^\s/u.test(rest)) { i++; continue; }
    if (rest.startsWith('//')) { const start = i; i = source.indexOf('\n', i + 2); if (i < 0) i = source.length; hide(start, i); continue; }
    if (rest.startsWith('/*')) { const start = i; const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; hide(start, i); continue; }
    const prefix = rest.match(/^\$*@|^@\$|^\$|^@/u)?.[0] ?? '';
    const quoteAt = i + prefix.length;
    if (source[quoteAt] === '"') {
      const start = i;
      const raw = source.slice(quoteAt).match(/^"{3,}/u)?.[0];
      if (raw) { const end = source.indexOf(raw, quoteAt + raw.length); i = end < 0 ? source.length : end + raw.length; hide(start, i); continue; }
      let j = quoteAt + 1;
      let value = '';
      const verbatim = prefix.includes('@');
      let interpolation = 0;
      while (j < source.length) {
        if (source[j] === '"') {
          if (prefix.includes('$') && interpolation > 0) {
            j++;
            while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
            j++; continue;
          }
          if (verbatim && source[j + 1] === '"') { value += '"'; j += 2; continue; }
          j++; break;
        }
        if (prefix.includes('$') && source[j] === '{' && source[j + 1] !== '{') { interpolation++; j++; continue; }
        if (prefix.includes('$') && source[j] === '}' && interpolation > 0) { interpolation--; j++; continue; }
        if (!verbatim && source[j] === '\\') { j += 2; continue; }
        value += source[j++];
      }
      if (!prefix.includes('$')) result.push({ kind: 'string', value, at: start });
      hide(start, j);
      i = j; continue;
    }
    if (rest[0] === "'") {
      const start = i;
      let j = i + 1;
      while (j < source.length && source[j] !== "'") j += source[j] === '\\' ? 2 : 1;
      hide(start, Math.min(j + 1, source.length));
      i = j + 1; continue;
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z_0-9]*/u);
    if (word) { result.push({ kind: 'word', value: word[0], at: i }); i += word[0].length; continue; }
    result.push({ kind: 'punct', value: rest[0], at: i }); i++;
  }
  return { tokens: result, neutralized: chars.join('') };
}
export const tokens = (source) => scanCsharp(source).tokens;
export const neutralizeCsharp = (source) => scanCsharp(source).neutralized;

const attr = (list, name) => list.find((item) => item.name === name);
function attributes(items) {
  const result = [];
  for (let i = 0; i < items.length;) {
    const nameToken = items[i++];
    const name = nameToken?.value;
    if (!name) break;
    const args = [];
    if (items[i]?.value === '(') {
      i++;
      while (i < items.length && items[i].value !== ')') args.push(items[i++]);
      i++;
    }
    result.push({ name: name?.replace(/Attribute$/u, ''), args, at: nameToken.at });
    while (i < items.length && items[i].value !== ',') i++;
    i++;
  }
  return result;
}
const stringArg = (item) => item?.args.find((token) => token.kind === 'string')?.value;
const normalizeRoute = (route) => route.replace(/\{([A-Za-z][A-Za-z0-9_]*)(?::[^{}]+)?\??\}/gu, ':$1');
function policyOf(attrs) {
  const auth = attr(attrs, 'Authorize');
  if (!auth) return null;
  const value = stringArg(auth);
  const role = auth.args.some((token) => token.value === 'Roles');
  return value ? `${role ? 'role:' : ''}${value}` : 'authenticated';
}

const lineOf = (source, at) => source.slice(0, at).split('\n').length;
const camel = (name) => name[0].toLowerCase() + name.slice(1);
function dtoFields(dtoSources, type) {
  for (const { file, source } of dtoSources) {
    const { neutralized: clean, tokens: items } = scanCsharp(source);
    const declaration = new RegExp(`\\b(?:class|record)\\s+${type}\\b`, 'u').exec(clean);
    if (!declaration) continue;
    const opening = items.findIndex((item) => item.at >= declaration.index + declaration[0].length && item.value === '{');
    if (opening < 0) continue;
    let closing = opening + 1, nesting = 1;
    for (; closing < items.length && nesting; closing++) {
      if (items[closing].value === '{') nesting++;
      if (items[closing].value === '}') nesting--;
    }
    if (nesting) continue;
    const start = items[opening].at + 1;
    const body = clean.slice(start, items[closing - 1].at);
    let cursor = opening + 1, depth = 1;
    return [...body.matchAll(/\bpublic\s+([\w<>?,\[\]]+)\s+(\w+)\s*\{\s*get\s*;[^}]*\}\s*(?:=\s*([^;]+);)?/gu)]
      .filter((match) => {
        const at = start + match.index;
        while (cursor < closing - 1 && items[cursor].at < at) {
          if (items[cursor].value === '{') depth++;
          if (items[cursor].value === '}') depth--;
          cursor++;
        }
        return depth === 1;
      })
      .map((match) => {
        const original = source.slice(start + match.index, start + match.index + match[0].length);
        const initializer = match[3] === undefined ? undefined : original.slice(match[0].indexOf('=') + 1, -1).trim();
        const value = initializer && (/^-?\d+(?:\.\d+)?$/u.test(initializer) ? Number(initializer)
          : /^(?:true|false)$/u.test(initializer) ? initializer === 'true'
            : /^"[^"\n]*"$/u.test(initializer) ? initializer.slice(1, -1)
              : /^new\s+List<\w+>\s*\(\s*\)$/u.test(initializer) ? [] : undefined);
        return { name: camel(match[2]), type: match[1], source: `${file}:${lineOf(source, start + match.index)}`,
          ...(value !== undefined ? { default: value } : {}) };
      });
  }
  return [];
}
function childDtoType(type) {
  const clean = String(type ?? '').replace(/\?$/u, '').trim();
  const list = /^(?:List|IEnumerable|ICollection|IReadOnlyList)<\s*([A-Za-z_]\w*)\s*>$/u.exec(clean);
  const name = list?.[1] ?? (/^[A-Za-z_]\w*$/u.test(clean) ? clean : null);
  if (!name || /^(?:string|bool|boolean|int|long|short|double|decimal|float|Guid|DateTime|DateTimeOffset|object)$/iu.test(name)) return null;
  return { name, list: Boolean(list) };
}

function expandedResponseFields(dtoSources, fields, prefix) {
  const result = [], pending = [];
  for (const field of fields) {
    const path = `${prefix}${field.name}`;
    result.push({ ...field, path });
    const child = childDtoType(field.type);
    if (!child) continue;
    const nested = dtoFields(dtoSources, child.name);
    if (!nested.length) { pending.push(`tipo aninhado não resolvido: ${child.name} (${path})`); continue; }
    result.push(...nested.map((item) => ({ ...item, path: `${path}${child.list ? '[]' : ''}.${item.name}` })));
  }
  return { fields: result, pending };
}

export function collectCsharpErrors(controllerSource, endpoint, reachedMethods = []) {
  const clean = neutralizeCsharp(controllerSource);
  const action = resolveCsharpAction(controllerSource, endpoint.file, endpoint);
  const signature = action && [...clean.matchAll(new RegExp(`\\b${action.method}\\s*\\([^)]*\\)\\s*\\{`, 'gu'))]
    .find((match) => match.index === action.actionAt);
  let body = '';
  if (signature) {
    const start = signature.index + signature[0].lastIndexOf('{');
    let depth = 0, end = start;
    for (; end < clean.length; end++) {
      if (clean[end] === '{') depth++;
      if (clean[end] === '}' && --depth === 0) { end++; break; }
    }
    body = controllerSource.slice(start, end);
  }
  const errors = [];
  const add = (status, message, when) => {
    if (!errors.some((item) => item.status === status && item.message === message)) errors.push({ status, message, when });
  };
  const catchMessage = /catch\s*\(\s*Exception\s+(\w+)\s*\)\s*\{\s*return\s+BadRequest\s*\(\s*ResponseHttp\.ToReturn\s*\(\s*\1\.Message\s*\)\s*\)/u.test(body);
  if (catchMessage) add(400, 'Mensagem de erro', 'Exceção capturada pela action; corpo em ResponseHttp.ToReturn.');
  for (const method of reachedMethods) {
    if (!catchMessage) break;
    for (const match of String(method.excerpt ?? '').matchAll(/\bthrow\s+new\s+(?:[A-Za-z_]\w*)?Exception\s*\(\s*"([^"\n]*)"\s*\)/gu))
      add(400, match[1], 'Quando o serviço retorna esta falha.');
  }
  for (const match of body.matchAll(/\b(NotFound|Unauthorized|Forbid|StatusCode)\s*\(\s*(\d{3})?/gu)) {
    const status = ({ NotFound: 404, Unauthorized: 401, Forbid: 403 })[match[1]] ?? Number(match[2]);
    if (status) add(status, '—', `Resposta explícita da action (${match[1]}).`);
  }
  if ((endpoint.authorization ?? endpoint.policy) !== 'anonymous') add(401, 'Token ausente, inválido ou expirado', 'Autenticação exigida.');
  return errors;
}
export function resolveCsharpAction(source, file, endpoint) {
  if (!endpoint?.verb || !endpoint?.route || !Array.isArray(endpoint.actionParameterNames)) return null;
  const matches = readCsharpEndpoints(source, file, {}).filter((item) => item.verb === endpoint.verb
    && item.route.toLowerCase() === endpoint.route.toLowerCase()
    && JSON.stringify(item.actionParameterNames) === JSON.stringify(endpoint.actionParameterNames));
  return matches.length === 1 ? matches[0] : null;
}
function signatureParameters(items, route, dtoSources, file, source) {
  const groups = [];
  let group = [], depth = 0;
  for (const token of items) {
    if (token.value === '<' || token.value === '[') depth++;
    if (token.value === '>' || token.value === ']') depth--;
    if (token.value === ',' && depth === 0) { groups.push(group); group = []; } else group.push(token);
  }
  if (group.length) groups.push(group);
  return groups.flatMap((part) => {
    const words = part.filter((item) => item.kind === 'word');
    const name = words.at(-1)?.value;
    const type = words.at(-2)?.value;
    if (!name || !type) return [];
    const location = words.some((item) => item.value === 'FromBody') ? 'body'
      : words.some((item) => item.value === 'FromQuery') ? 'query'
        : words.some((item) => item.value === 'FromRoute') || new RegExp(`\\{${name}(?::[^{}]+)?\\??\\}`, 'iu').test(route) ? 'route' : 'query';
    const fields = dtoFields(dtoSources, type);
    return fields.length ? fields.map((field) => ({ ...field, in: location, dtoType: type, owner: name }))
      : [{ name: camel(name), type, in: location, owner: name, source: `${file}:${lineOf(source, words.at(-1).at)}` }];
  });
}
function actionSignatureNames(items) {
  const groups = [];
  let group = [], depth = 0;
  for (const token of items) {
    if (['<', '[', '('].includes(token.value)) depth++;
    if (['>', ']', ')'].includes(token.value)) depth--;
    if (token.value === ',' && depth === 0) { groups.push(group); group = []; }
    else group.push(token);
  }
  if (group.length) groups.push(group);
  return groups.map((part) => {
    let nested = 0;
    for (let i = 0; i < part.length; i++) {
      if (['<', '[', '('].includes(part[i].value)) nested++;
      if (['>', ']', ')'].includes(part[i].value)) nested--;
      if (part[i].value === '=' && nested === 0) return part.slice(0, i).filter((token) => token.kind === 'word').at(-1)?.value;
    }
    return part.filter((token) => token.kind === 'word').at(-1)?.value;
  }).filter(Boolean);
}

function assignedPaths(body, parameterNames) {
  const items = tokens(body);
  const assigned = [];
  const assignmentAt = (index) => items[index]?.value === '=' && items[index + 1]?.value !== '=' && items[index - 1]?.value !== '='
    || items[index]?.value === '?' && items[index + 1]?.value === '?' && items[index + 2]?.value === '=';
  for (let i = 0; i < items.length; i++) {
    const root = items[i];
    if (!parameterNames.has(root.value) || items[i - 1]?.value === '.') continue;
    let cursor = i;
    const path = [];
    while (items[cursor + 1]?.value === '.' && items[cursor + 2]?.kind === 'word') {
      path.push(items[cursor + 2].value);
      cursor += 2;
    }
    if (path.length && assignmentAt(cursor + 1)) assigned.push({ owner: root.value, path, at: root.at });
    if (path.length || items[i + 1]?.value !== '=' || items[i + 2]?.value === '=') continue;
    let brace = -1;
    if (items[i + 2]?.value === root.value && items[i + 3]?.value === 'with' && items[i + 4]?.value === '{') brace = i + 4;
    if (items[i + 2]?.value === 'new' && items[i + 3]?.kind === 'word' && items[i + 4]?.value === '{') brace = i + 4;
    if (brace < 0) continue;
    let depth = 1;
    for (let j = brace + 1; j < items.length && depth; j++) {
      if (items[j].value === '{') depth++;
      if (items[j].value === '}') depth--;
      if (depth === 1 && items[j].kind === 'word' && assignmentAt(j + 1)
        && (items[j - 1]?.value === '{' || items[j - 1]?.value === ','))
        assigned.push({ owner: root.value, path: [items[j].value], at: items[j].at });
    }
  }
  return assigned;
}

function nestedField(dtoSources, type, path) {
  let field;
  for (const part of path) {
    field = dtoFields(dtoSources, type).find((item) => item.name.toLowerCase() === part.toLowerCase());
    if (!field) return null;
    type = field.type;
  }
  return field;
}

function responseTypeOf(declaration, attrs) {
  const fromAttribute = attr(attrs, 'ProducesResponseType')?.args;
  const typeofIndex = fromAttribute?.findIndex((item) => item.value === 'typeof') ?? -1;
  if (typeofIndex >= 0) return fromAttribute.slice(typeofIndex + 1).find((item) => item.kind === 'word')?.value;
  const result = declaration.match(/\b(?:Task|ActionResult|IEnumerable|List|PagedResult)<[\w<>?,\s]+>/u)?.[0];
  if (!result) return null;
  let type = result.replace(/\s+/gu, '');
  while (/^(?:Task|ActionResult|IEnumerable|List|PagedResult)</u.test(type)) type = type.slice(type.indexOf('<') + 1, -1);
  return /^\w+$/u.test(type) ? type : null;
}

function okResponseType(body) {
  const items = tokens(body);
  for (let index = 0; index < items.length - 4; index++) {
    if (items[index].value !== 'return' || items[index + 1].value !== 'Ok' || items[index + 2].value !== '(') continue;
    const argument = items[index + 3];
    if (argument.value === 'new' && items[index + 4]?.kind === 'word') return items[index + 4].value;
    if (argument.kind !== 'word' || items[index + 4]?.value !== ')') continue;
    for (let declaration = index - 1; declaration >= 1; declaration--) {
      if (items[declaration].value !== argument.value || items[declaration + 1]?.value !== '=' || items[declaration - 1]?.kind !== 'word') continue;
      const type = items[declaration - 1].value;
      if (type !== 'var') return type;
      if (items[declaration + 2]?.value === 'new' && items[declaration + 3]?.kind === 'word') return items[declaration + 3].value;
      return null;
    }
  }
  return null;
}

function actionBodyOf(source, items, start) {
  if (items[start]?.value !== '{') return '';
  let depth = 0;
  for (let index = start; index < items.length; index++) {
    if (items[index].value === '{') depth++;
    if (items[index].value === '}' && --depth === 0) return source.slice(items[start].at, items[index].at + 1);
  }
  return '';
}

function simpleType(type) {
  const value = String(type ?? '').replace(/\s|\?/gu, '');
  if (/^(?:List|IEnumerable)<|\[\]$/u.test(value)) return 'list';
  if (/^string$/iu.test(value)) return 'string';
  if (/^(?:int|long|short|double|decimal|float)$/iu.test(value)) return 'number';
  if (/^bool$/iu.test(value)) return 'boolean';
  return null;
}

function callArguments(body, open) {
  const parts = [];
  let start = open + 1, depth = 1;
  for (let i = start; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')' && --depth === 0) {
      if (body.slice(start, i).trim()) parts.push(body.slice(start, i).trim());
      return parts;
    } else if (body[i] === ',' && depth === 1) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

function argumentType(argument, actionBody, signature) {
  if (/^@?"/u.test(argument)) return 'string';
  if (/^-?\d+(?:\.\d+)?$/u.test(argument)) return 'number';
  if (/^(?:true|false)$/u.test(argument)) return 'boolean';
  if (/^new\s+(?:List|IEnumerable)<|^new\s*\[|^\[\s*\]/u.test(argument)) return 'list';
  if (!/^[A-Za-z_]\w*$/u.test(argument)) return null;
  const declared = /\b((?:List|IEnumerable)\s*<[^>]+>|[A-Za-z_]\w*(?:\[\])?)\s+([A-Za-z_]\w*)\s*(?:[,)=;]|$)/gu;
  const declarations = [...signature.matchAll(declared), ...actionBody.matchAll(declared)];
  return simpleType(declarations.filter((match) => match[2] === argument).at(-1)?.[1]);
}

function serviceResponse(body, controllerSource, serviceSources, signature = '') {
  const wrapped = body.match(/\breturn\s+Ok\s*\(\s*ResponseHttp\.ToReturn\s*\(\s*([A-Za-z_]\w*)\s*\)\s*\)/u);
  const direct = body.match(/\breturn\s+Ok\s*\(\s*([A-Za-z_]\w*)\s*\)/u);
  if (!wrapped && !direct) return null;
  const value = (wrapped ?? direct)[1];
  const assignment = new RegExp(`\\b(?:var|[A-Za-z_]\\w*)\\s+${value}\\s*=\\s*await\\s+(_[A-Za-z_]\\w*)\\.([A-Za-z_]\\w*)\\s*\\(`, 'u').exec(body);
  if (!assignment) return null;
  const receiver = assignment[1], method = assignment[2];
  const args = callArguments(body, assignment.index + assignment[0].length - 1);
  if (!args) return null;
  const type = neutralizeCsharp(controllerSource).match(new RegExp(`\\b(?:private|protected|public)\\s+(?:readonly\\s+)?([A-Za-z_]\\w*)\\s+${receiver}\\s*;`, 'u'))?.[1];
  if (!type) return null;
  const allowedTypes = new Set([type, type.startsWith('I') ? type.slice(1) : `I${type}`]);
  const declarations = serviceSources.filter(({ file }) => allowedTypes.has(file.split('/').at(-1).replace(/\.cs$/u, '')))
    .flatMap(({ source, file }) => [...neutralizeCsharp(source).matchAll(new RegExp(`\\b(Task\\s*<\\s*(?:(?:List|IEnumerable)\\s*<\\s*)?[A-Za-z_]\\w*\\s*>\\s*>|Task\\s*<\\s*[A-Za-z_]\\w*\\s*>|IEnumerable\\s*<\\s*[A-Za-z_]\\w*\\s*>)\\s+${method}\\s*\\(`, 'gu'))]
    .map((match) => ({ type: match[1].replace(/\s+/gu, ''), args: callArguments(neutralizeCsharp(source), match.index + match[0].length - 1),
      source: `${file}:${lineOf(source, match.index)}` })));
  let candidates = declarations.filter((item) => item.args?.length === args.length);
  const known = args.map((argument) => argumentType(argument, body, signature));
  for (let i = 0; i < known.length; i++) if (known[i])
    candidates = candidates.filter((item) => simpleType(item.args[i].replace(/\s+[A-Za-z_]\w*$/u, '')) === known[i]);
  const distinct = [...new Set(candidates.map((item) => item.type.replace(/^Task</u, '').replace(/>$/u, '')))];
  if (distinct.length !== 1) return null;
  const returnType = distinct[0];
  const list = /^(?:List|IEnumerable)</u.test(returnType);
  const inner = returnType.replace(/^(?:List|IEnumerable)</u, '').replace(/>$/u, '');
  return /^\w+$/u.test(inner) ? { type: inner, list, envelope: Boolean(wrapped) } : null;
}

export function readCsharpEndpoints(source, file, { dtoSources = [], serviceSources = [] } = {}) {
  const { tokens: t, neutralized: clean } = scanCsharp(source);
  const endpoints = [];
  let pending = [];
  let depth = 0;
  let controller = null;
  for (let i = 0; i < t.length; i++) {
    const value = t[i].value;
    if (value === '[') {
      let end = i + 1;
      while (end < t.length && t[end].value !== ']') end++;
      pending.push(...attributes(t.slice(i + 1, end)));
      i = end; continue;
    }
    if (value === 'class' && t[i + 1]?.kind === 'word') {
      const name = t[i + 1].value;
      const brace = t.findIndex((token, index) => index > i && token.value === '{');
      controller = { name, attrs: pending, depth: depth + 1 };
      pending = [];
      if (brace < 0) break;
      continue;
    }
    const http = pending.find((item) => /^Http(Get|Post|Put|Patch|Delete|Head|Options)$/u.test(item.name));
    if (http && controller && depth === controller.depth && value === '(' && t[i - 1]?.kind === 'word') {
      const method = t[i - 1].value;
      const anonymous = Boolean(attr(pending, 'AllowAnonymous') || attr(controller.attrs, 'AllowAnonymous'));
      const policy = anonymous ? 'anonymous' : policyOf(pending) ?? policyOf(controller.attrs) ?? 'anonymous';
      const base = stringArg(attr(controller.attrs, 'Route')) ?? '';
      const action = stringArg(http) ?? '';
      const reference = arguments.length > 2;
      const version = stringArg(attr(controller.attrs, 'ApiVersion')) ?? '';
      const combined = action.startsWith('~/') ? action.slice(2) : action.startsWith('/') ? action : [base, action].filter(Boolean).join('/');
      const expanded = combined.replace(/\{version:apiVersion\}/gu, version);
      const normalizeReference = (value) => `/${value.replace(/\{([A-Za-z][A-Za-z0-9_]*)(?::[^{}]+)?\??\}/gu, '{$1}').replace(/^\/+|\/+$/gu, '')}`;
      const route = reference
        ? normalizeReference(expanded)
        : normalizeRoute(combined.replace(/^\/+|\/+$/gu, ''));
      const controllerRoute = reference && base ? `/${base.replace(/\{version:apiVersion\}/gu, version)
        .replace(/\{([A-Za-z][A-Za-z0-9_]*)(?::[^{}]+)?\??\}/gu, '{$1}').replace(/^\/+|\/+$/gu, '')}` : undefined;
      const optionalAliases = [];
      const optionalNames = new Set();
      if (reference) {
        let suffix = expanded;
        let optional;
        while ((optional = suffix.match(/\/\{([A-Za-z][A-Za-z0-9_]*)(?::[^{}]+)?\?\}$/u))) {
          optionalNames.add(optional[1].toLowerCase());
          suffix = suffix.slice(0, -optional[0].length);
          optionalAliases.push(normalizeReference(suffix));
        }
      }
      const optionalAlias = optionalAliases[0] ?? null;
      let end = i + 1, nesting = 1;
      while (end < t.length && nesting) { if (t[end].value === '(') nesting++; if (t[end].value === ')') nesting--; end++; }
      const location = `${file}:${lineOf(source, t[i - 1].at)}`;
      const actionParameterNames = actionSignatureNames(t.slice(i + 1, end - 1));
      const routeSource = `${file}:${lineOf(source, attr(controller.attrs, 'Route')?.at ?? http.at)}`;
      const verbSource = `${file}:${lineOf(source, http.at)}`;
      const authorizationAttribute = attr(pending, 'AllowAnonymous') ?? attr(controller.attrs, 'AllowAnonymous')
        ?? attr(pending, 'Authorize') ?? attr(controller.attrs, 'Authorize');
      const authorizationSource = authorizationAttribute ? `${file}:${lineOf(source, authorizationAttribute.at)}` : null;
      const rawParameters = reference ? signatureParameters(t.slice(i + 1, end - 1), route, dtoSources, file, source) : undefined;
      const actionBody = actionBodyOf(clean, t, end);
      const owners = new Map();
      for (const item of rawParameters ?? []) if (item.dtoType) owners.set(item.owner, item.dtoType);
      const assignments = assignedPaths(actionBody, new Set((rawParameters ?? []).map((item) => item.owner)));
      const direct = (item) => assignments.find((assignment) => assignment.owner === item.owner
        && assignment.path.length === 1 && assignment.path[0].toLowerCase() === item.name.toLowerCase());
      const serverAssigned = rawParameters?.flatMap((item) => {
        const assignment = direct(item);
        return assignment ? [{ name: item.name, serverAssigned: true,
          source: `${file}:${lineOf(source, t[end].at + assignment.at)}` }] : [];
      }) ?? [];
      for (const assignment of assignments) {
        if (assignment.path.length < 2 || !owners.has(assignment.owner)) continue;
        if (!nestedField(dtoSources, owners.get(assignment.owner), assignment.path)) continue;
        serverAssigned.push({ name: assignment.path.map(camel).join('.'), serverAssigned: true,
          source: `${file}:${lineOf(source, t[end].at + assignment.at)}` });
      }
      const parameters = rawParameters?.filter((item) => !direct(item))
        .map(({ dtoType: _dtoType, owner: _owner, ...item }) => ({ ...item, ...(item.in === 'route' ? { required: !optionalNames.has(item.name.toLowerCase()) } : {}), source: item.source ?? location }));
      const declaration = clean.slice(Math.max(0, clean.lastIndexOf('public ', t[i - 1].at)), t[i - 1].at);
      const declaredResultType = responseTypeOf(declaration, pending);
      const resultType = declaredResultType === 'IActionResult' || !declaredResultType
        ? okResponseType(actionBody) : declaredResultType;
      const service = !resultType ? serviceResponse(actionBodyOf(source, t, end), source, serviceSources,
        source.slice(t[i].at, t[end - 1]?.at ?? t[i].at)) : null;
      const resolvedType = resultType ?? service?.type ?? null;
      const fields = resolvedType ? dtoFields(dtoSources, resolvedType) : [];
      const expandedFields = fields.length ? expandedResponseFields(dtoSources, fields,
        service?.envelope ? `dados${service.list ? '[]' : ''}.` : service?.list ? '[].' : '') : null;
      const responseFields = expandedFields?.fields ?? null;
      const responsePending = responseFields === null ? [`campos de resposta não verificáveis: ${http.name.slice(4).toUpperCase()} ${route}`] : expandedFields.pending;
      endpoints.push({ controller: controller.name, method, verb: http.name.slice(4).toUpperCase(), route,
        actionLine: lineOf(source, t[i - 1].at), actionAt: t[i - 1].at, actionParameterNames, policy, name: policy,
        ...(reference ? { controllerRoute, parameters, serverAssigned, responseFields, responseType: resolvedType,
          responseEnvelope: service?.envelope ? 'dados' : null, responseList: service?.list ?? false,
          pending: responsePending, optionalAlias, optionalAliases, dtoTypes: [...new Set([...rawParameters.flatMap(({ type, dtoType }) => [type, dtoType]), resolvedType].filter(Boolean))], source: verbSource,
          routeSource, actionRouteSource: verbSource, verbSource, authorizationSource, authorization: policy } : {}) });
      pending = [];
    }
    if (value === '{') depth++;
    if (value === '}') {
      depth--;
      if (controller && depth < controller.depth) controller = null;
    }
  }
  return endpoints;
}
