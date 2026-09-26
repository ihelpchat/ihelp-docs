// A narrow C# lexer: comments and string bodies cannot create attributes.
function tokens(source) {
  const result = [];
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i);
    if (/^\s/u.test(rest)) { i++; continue; }
    if (rest.startsWith('//')) { i = source.indexOf('\n', i + 2); if (i < 0) break; continue; }
    if (rest.startsWith('/*')) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
    const prefix = rest.match(/^\$*@|^@\$|^\$|^@/u)?.[0] ?? '';
    const quoteAt = i + prefix.length;
    if (source[quoteAt] === '"') {
      const raw = source.slice(quoteAt).match(/^"{3,}/u)?.[0];
      if (raw) { const end = source.indexOf(raw, quoteAt + raw.length); i = end < 0 ? source.length : end + raw.length; continue; }
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
      if (!prefix.includes('$')) result.push({ kind: 'string', value });
      i = j; continue;
    }
    if (rest[0] === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== "'") j += source[j] === '\\' ? 2 : 1;
      i = j + 1; continue;
    }
    const word = rest.match(/^[A-Za-z_][A-Za-z_0-9]*/u);
    if (word) { result.push({ kind: 'word', value: word[0], at: i }); i += word[0].length; continue; }
    result.push({ kind: 'punct', value: rest[0], at: i }); i++;
  }
  return result;
}

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
    const declaration = new RegExp(`\\b(?:class|record)\\s+${type}\\b`, 'u').exec(source);
    if (!declaration) continue;
    const body = source.slice(declaration.index).split(/\n\s*\}\s*(?:;|$)/u)[0];
    return [...body.matchAll(/\bpublic\s+([\w<>?,\[\]]+)\s+(\w+)\s*\{\s*get\s*;/gu)]
      .map((match) => ({ name: camel(match[2]), type: match[1], source: `${file}:${lineOf(source, declaration.index + match.index)}` }));
  }
  return [];
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
    return fields.length ? fields.map((field) => ({ ...field, in: location, dtoType: type }))
      : [{ name: camel(name), type, in: location, source: `${file}:${lineOf(source, words.at(-1).at)}` }];
  });
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

export function readCsharpEndpoints(source, file, { dtoSources = [] } = {}) {
  const t = tokens(source);
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
      const route = reference
        ? `/${[base, action].filter(Boolean).join('/').replace(/\{version:apiVersion\}/gu, version)
          .replace(/\{([A-Za-z][A-Za-z0-9_]*)(?::[^{}]+)?\??\}/gu, '{$1}').replace(/\/+$/u, '')}`
        : normalizeRoute([base, action].filter(Boolean).join('/'));
      const optionalAlias = reference && /(?:^|\/)\{[A-Za-z][A-Za-z0-9_]*(?::[^{}]+)?\?\}$/u.test(action)
        ? route.replace(/\/\{[A-Za-z][A-Za-z0-9_]*\}$/u, '') : null;
      let end = i + 1, nesting = 1;
      while (end < t.length && nesting) { if (t[end].value === '(') nesting++; if (t[end].value === ')') nesting--; end++; }
      const location = `${file}:${lineOf(source, t[i - 1].at)}`;
      const routeSource = `${file}:${lineOf(source, attr(controller.attrs, 'Route')?.at ?? http.at)}`;
      const verbSource = `${file}:${lineOf(source, http.at)}`;
      const authorizationAttribute = attr(pending, 'AllowAnonymous') ?? attr(controller.attrs, 'AllowAnonymous')
        ?? attr(pending, 'Authorize') ?? attr(controller.attrs, 'Authorize');
      const authorizationSource = authorizationAttribute ? `${file}:${lineOf(source, authorizationAttribute.at)}` : null;
      const rawParameters = reference ? signatureParameters(t.slice(i + 1, end - 1), route, dtoSources, file, source) : undefined;
      const actionBody = actionBodyOf(source, t, end);
      const assigned = new Set([...actionBody.matchAll(/\b(\w+)\.(\w+)\s*=(?!=)/gu)].map((match) => match[2].toLowerCase()));
      const parameters = rawParameters?.filter((item) => item.in !== 'query' || !assigned.has(item.name.toLowerCase()))
        .map(({ dtoType: _dtoType, ...item }) => ({ ...item, source: item.source ?? location }));
      const declaration = source.slice(Math.max(0, source.lastIndexOf('public ', t[i - 1].at)), t[i - 1].at);
      const declaredResultType = responseTypeOf(declaration, pending);
      const resultType = declaredResultType === 'IActionResult' || !declaredResultType
        ? okResponseType(actionBody) : declaredResultType;
      const fields = resultType ? dtoFields(dtoSources, resultType) : [];
      const responseFields = fields.length ? fields : null;
      const responsePending = responseFields === null ? [`campos de resposta não verificáveis: ${http.name.slice(4).toUpperCase()} ${route}`] : [];
      endpoints.push({ controller: controller.name, method, verb: http.name.slice(4).toUpperCase(), route, policy, name: policy,
        ...(reference ? { parameters, responseFields, responseType: resultType, pending: responsePending, optionalAlias, dtoTypes: [...new Set([...rawParameters.flatMap(({ type, dtoType }) => [type, dtoType]), resultType].filter(Boolean))], source: verbSource,
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
