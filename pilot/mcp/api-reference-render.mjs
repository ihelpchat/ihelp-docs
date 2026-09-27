import { syntheticResponseExample, valueFor } from './api-synthetic-example.mjs';
const safe = (value) => String(value ?? '').replace(/[<>{}"`]/gu, '');
export { valueFor } from './api-synthetic-example.mjs';
const publicTypes = new Map([
  ['DateTime', 'data e hora'], ['int', 'número'], ['long', 'número'], ['decimal', 'número'],
  ['bool', 'verdadeiro ou falso'], ['string', 'texto'], ['Guid', 'texto'],
]);
const publicType = (raw) => {
  const type = String(raw ?? '').trim();
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  const collection = base.match(/^(?:List|IEnumerable|ICollection|IList)<\s*(.+)\s*>$|^(.+)\[\]$/u);
  let label;
  if (collection) {
    const item = publicType(collection[1] ?? collection[2]).replace(/ \(opcional\)$/u, '');
    label = `lista de ${item === 'objeto' ? 'objetos' : item === 'número' ? 'números' : item}`;
  } else label = publicTypes.get(base) ?? (['double', 'float', 'short', 'number'].includes(base) ? 'número' : 'objeto');
  return `${label}${optional ? ' (opcional)' : ''}`;
};
export function internalTypeIssue(text) {
  const type = String(text).match(/\b(?:List|IEnumerable)\s*<\s*[A-Za-z_]\w*\??\s*>\??|\b(?:DateTime|int|long|decimal|bool|string|Guid)\??(?=$|[^\p{L}\p{N}_])/gu)?.[0];
  if (!type) return null;
  const kind = /^(?:List|IEnumerable)\s*</u.test(type) ? 'lista' : publicTypes.get(type.replace(/\?$/u, ''));
  return `tipo interno na prosa: ${type}; use a descrição pública (${kind ?? 'data e hora, número, texto, verdadeiro ou falso, lista'})`;
}
export const isSyntheticNumericExample = (value) => value === valueFor({ name: 'phone', type: 'string' });
const publicRoute = (route) => route.replace(/^\/api\/v\d+/iu, '');
const simpleFieldName = (name) => name.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/[_-]+/gu, ' ').toLocaleLowerCase('pt-BR');
export const responseFieldPath = (endpoint, field) => field.path ?? `${endpoint.responseEnvelope ? `${endpoint.responseEnvelope}${endpoint.responseList ? '[]' : ''}.` : endpoint.responseList ? '[].' : ''}${field.name}`;

// The endpoint and the observed page vocabulary are the only inputs to technical MDX.
export function renderApiReference(endpoint, examples, page) {
  const factRoute = publicRoute(endpoint.route);
  const referenceRoute = page?.frontmatter?.endpoint;
  const shape = (route) => route.toLowerCase().replace(/\{[^}]+\}/gu, '{}');
  const aliases = endpoint.optionalAliases ?? (endpoint.optionalAlias ? [endpoint.optionalAlias] : []);
  const sameShape = referenceRoute && [factRoute, ...aliases.map(publicRoute)]
    .filter(Boolean).some((route) => shape(route) === shape(referenceRoute));
  const canonicalRoute = factRoute.replace(/\{([^}]+)\}/gu, (_, name) => `{${endpoint.parameters?.find((item) => item.in === 'route' && item.name.toLowerCase() === name.toLowerCase())?.name ?? name}}`);
  const displayRoute = sameShape ? referenceRoute.replace(/\{([^}]+)\}/gu, (_, name) => `{${endpoint.parameters?.find((item) => item.in === 'route' && item.name.toLowerCase() === name.toLowerCase())?.name ?? name}}`) : canonicalRoute;
  const sampleRoute = aliases.find((route) => referenceRoute && shape(publicRoute(route)) === shape(referenceRoute)) ?? endpoint.route;
  const sample = sampleRoute.replace(/\{([^}]+)\}/gu, (_, name) =>
    valueFor(endpoint.parameters?.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? { type: 'string' }));
  const factParts = factRoute.split('/');
  const displayParts = displayRoute.split('/');
  const omitted = new Set((endpoint.parameters ?? []).filter((item) => item.in === 'route' && item.required === false
    && !displayRoute.toLowerCase().includes(`{${item.name.toLowerCase()}}`)).map((item) => item.name.toLowerCase()));
  const parameters = (endpoint.parameters ?? []).filter((item) => !omitted.has(item.name.toLowerCase())).map((item) => {
    if (item.in !== 'route' || !sameShape) return item;
    const at = factParts.findIndex((part) => part.toLowerCase() === `{${item.name.toLowerCase()}}`);
    return at >= 0 && /^\{\w+\}$/u.test(displayParts[at])
      ? { ...item, name: displayParts[at].slice(1, -1) } : item;
  });
  const query = parameters.filter((item) => item.in === 'query');
  const bodyFields = parameters.filter((item) => item.in === 'body');
  const requestBody = Object.fromEntries(bodyFields.map((item) => [item.name, /^(?:int|long|double|decimal|float|short|number)$/iu.test(item.type) ? Number(valueFor(item)) : /^bool(?:ean)?$/iu.test(item.type) ? valueFor(item) === 'true' : valueFor(item)]));
  const bodyJson = JSON.stringify(requestBody);
  const exampleQuery = query.filter((item) => item.required || /^(?:page|limit|searchData)$/iu.test(item.name));
  const queryString = exampleQuery.length ? `?${exampleQuery.flatMap((item) => [valueFor(item)].flat().map((value) => `${encodeURIComponent(item.name)}=${encodeURIComponent(value)}`)).join('&')}` : '';
  const example = page ?? examples?.find((item) => item.sections?.includes('Exemplo')) ?? examples?.[0];
  const url = `https://apiv3.ihelpchat.com${sample}${queryString}`;
  const sections = example?.sections ?? [];
  const components = new Set(example?.components ?? []);
  const languages = new Set(example?.languages ?? []);
  const paramTag = components.has('Param') ? 'Param' : null;
  const fieldsTag = components.has('Field') ? 'Field' : null;
  const paragraphs = [];
  const add = (kind, body) => paragraphs.push({ kind, body });
  const heading = (name, fallback) => sections.find((section) => section.toLowerCase().startsWith(name)) ?? fallback;

  if (parameters.length && paramTag) {
    const title = parameters.every((item) => item.in === 'route') ? heading('parâmetros de rota', 'Parâmetros de rota') : heading('parâmetros', 'Parâmetros');
    add('parâmetros', `## ${title}\n\n<Params>\n${parameters.map((item) => {
      const publicType = publicTypes.get(String(item.type).replace(/\?$/u, ''));
      const array = /^(?:List|IEnumerable)\s*<\s*(int|long|double|decimal|float|short|number)\s*>$|^(?:int|long|double|decimal|float|short|number)\[\]$/iu.test(item.type);
      const type = array ? 'array' : publicType === 'número' || /^(?:double|float|short)$/iu.test(item.type) ? 'number'
        : publicType === 'verdadeiro ou falso' || /^boolean$/iu.test(item.type) ? 'boolean' : 'string';
      const required = item.required ?? (item.in === 'route' || (item.in === 'body' && !item.type.endsWith('?')));
      const label = array ? 'lista de números' : safe(item.type);
      const defaultValue = Object.hasOwn(item, 'default') && item.default !== '' && item.default !== null;
      const description = page?.parameterDescriptions?.[item.name];
      return `<Param name="${safe(item.name)}" type="${type}"${required ? ' required' : ''}>${safe(item.in)} (${label})${required ? '' : ', opcional'}${defaultValue ? `; padrão: ${safe(JSON.stringify(item.default))}` : ''}${description ? ` — ${safe(description)}` : ''}</Param>`;
    }).join('\n')}\n</Params>`);
  }

  const auth = endpoint.authorization ?? endpoint.policy;
  const requestHeaders = [
    ...(auth && auth !== 'anonymous' ? ['Authorization'] : []),
    ...(bodyFields.length ? ['Content-Type'] : []),
  ];
  const headerValue = (language, name) => name === 'Content-Type' ? 'application/json' : ({
    bash: 'Bearer $IHELP_TOKEN',
    js: '`Bearer ${process.env.IHELP_TOKEN}`',
    python: 'f"Bearer {os.environ[\'IHELP_TOKEN\']}"',
    http: 'Bearer $IHELP_TOKEN',
  })[language];
  if (requestHeaders.includes('Authorization')) add('autorização', 'Requer autenticação. Envie `Authorization: Bearer $IHELP_TOKEN`.');
  const blocks = [];
  if (languages.has('bash')) blocks.push(`\`\`\`bash\ncurl${endpoint.verb === 'GET' ? '' : ` -X ${endpoint.verb}`} "${url}"${requestHeaders.map((name) => ` -H "${name}: ${headerValue('bash', name)}"`).join('')}${bodyFields.length ? ` -d '${bodyJson}'` : ''}\n\`\`\``);
  if (languages.has('js')) blocks.push(`\`\`\`js\nconst res = await fetch('${url}', { method: '${endpoint.verb}'${requestHeaders.length ? `, headers: { ${requestHeaders.map((name) => `${JSON.stringify(name)}: ${name === 'Authorization' ? headerValue('js', name) : JSON.stringify(headerValue('js', name))}`).join(', ')} }` : ''}${bodyFields.length ? `, body: JSON.stringify(${bodyJson})` : ''} });${endpoint.responseEnvelope ? `\nconst { ${endpoint.responseEnvelope} } = await res.json();` : ''}\n\`\`\``);
  if (languages.has('python')) blocks.push(`\`\`\`python\nimport os, requests\nr = requests.request('${endpoint.verb}', '${url}'${requestHeaders.length ? `, headers={${requestHeaders.map((name) => `${JSON.stringify(name)}: ${name === 'Authorization' ? headerValue('python', name) : JSON.stringify(headerValue('python', name))}`).join(', ')}}` : ''}${bodyFields.length ? `, json=${bodyJson.replace(/\btrue\b/gu, 'True').replace(/\bfalse\b/gu, 'False')}` : ''}, timeout=15)${endpoint.responseEnvelope ? `\nrows = r.json()[${JSON.stringify(endpoint.responseEnvelope)}]` : ''}\n\`\`\``);
  if (languages.has('http')) blocks.push(`\`\`\`http\n${endpoint.verb} ${url}${requestHeaders.map((name) => `\n${name}: ${headerValue('http', name)}`).join('')}${bodyFields.length ? `\n\n${bodyJson}` : ''}\n\`\`\``);
  if (blocks.length) add('exemplo', `## ${heading('exemplo', 'Exemplo')}\n\nValores fictícios para exemplo.\n\n${components.has('CodeTabs') ? `<CodeTabs labels={${JSON.stringify([...languages].map((language) => ({ bash: 'cURL', js: 'Node', python: 'Python', http: 'URL' })[language]))}}>\n\n` : ''}${blocks.join('\n\n')}${components.has('CodeTabs') ? '\n\n</CodeTabs>' : ''}`);

  if (endpoint.responseFields === null) add('resposta', `## ${heading('resposta', 'Resposta')}\n\nCampos de resposta ainda não documentados.`);
  else {
    const synthetic = syntheticResponseExample(endpoint);
    add('resposta', `## ${heading('resposta', 'Resposta')}\n\n${components.has('Fields') ? '<Fields>\n' : ''}${endpoint.responseFields.map((field) => `<Field name="${safe(responseFieldPath(endpoint, field))}">${publicType(field.type)} — ${safe(page?.responseDescriptions?.[responseFieldPath(endpoint, field)] ?? simpleFieldName(field.name))}</Field>`).join('\n')}${components.has('Fields') ? '\n</Fields>' : ''}${synthetic ? `\n\n\`\`\`json\n${JSON.stringify(synthetic, null, 2)}\n\`\`\`` : ''}`);
  }
  if (endpoint.errors?.length) {
    const cell = (value) => safe(value).replace(/\|/gu, '\\|').replace(/\s+/gu, ' ');
    const internal = /\b(?:DTO|entity|repository|service|action|ToReturn)\b|\b[A-Z]\w*\.[A-Z]\w*\b|\b[A-Z]\w*(?:Controller|Service|Repository|DTO)\b/iu;
    const message = (value) => internal.test(String(value)) ? 'Mensagem de erro' : cell(value);
    const when = (value) => internal.test(String(value))
      ? 'Falha ao processar a requisição; a mensagem vem no campo `dados`.' : cell(value);
    add('erros', `## Erros comuns\n\n| HTTP | Mensagem | Quando |\n|---|---|---|\n${endpoint.errors.map((error) => `| ${error.status} | ${message(error.message)} | ${when(error.when)} |`).join('\n')}`);
  }
  const order = (kind) => kind === 'autorização' ? -1 : sections.findIndex((section) => section.toLowerCase().startsWith(kind === 'campos' ? 'campos relevantes' : kind));
  const rank = (kind) => kind === 'autorização' ? -1 : order(kind) < 0 ? 100 : order(kind);
  paragraphs.sort((left, right) => rank(left.kind) - rank(right.kind));
  const pageNames = new Set(page?.paramNames?.map((name) => name.toLowerCase()) ?? []);
  const factNames = new Set(parameters.map((item) => item.name.toLowerCase()));
  const parameterPending = Array.isArray(page?.paramNames) ? [
    ...page.paramNames.filter((name) => omitted.has(name.toLowerCase()))
      .map((name) => `parâmetro opcional omitido da rota citada: ${name}`),
    ...page.paramNames.filter((name) => !omitted.has(name.toLowerCase()) && !factNames.has(name.toLowerCase()))
      .map((name) => `parâmetro na página sem fato no código: ${name}`),
    ...parameters.filter((item) => !pageNames.has(item.name.toLowerCase()))
      .map((item) => `parâmetro no código ausente da página: ${item.name}`),
  ] : [];
  return { source: 'api', contentType: 'referencia', method: endpoint.verb,
    endpoint: displayRoute, body: paragraphs.map((item) => item.body).join('\n\n'),
    pending: [...parameterPending, ...(endpoint.responseFields === null ? [`campos de resposta não verificáveis: ${endpoint.verb} ${endpoint.route}`] : [])] };
}
