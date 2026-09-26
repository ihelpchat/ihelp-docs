const safe = (value) => String(value ?? '').replace(/[<>{}"`]/gu, '');
const valueFor = (parameter) => /^(?:int|long|double|decimal|float|short|number)$/iu.test(parameter.type) ? '1'
  : /^bool(?:ean)?$/iu.test(parameter.type) ? 'true' : 'abc123';
const publicRoute = (route) => route.replace(/^\/api\/v\d+/iu, '');

// The endpoint and the observed page vocabulary are the only inputs to technical MDX.
export function renderApiReference(endpoint, examples, page) {
  const factRoute = publicRoute(endpoint.route);
  const referenceRoute = page?.frontmatter?.endpoint;
  const shape = (route) => route.toLowerCase().replace(/\{[^}]+\}/gu, '{}');
  const sameShape = referenceRoute && [factRoute, endpoint.optionalAlias && publicRoute(endpoint.optionalAlias)]
    .filter(Boolean).some((route) => shape(route) === shape(referenceRoute));
  const displayRoute = sameShape ? referenceRoute : factRoute;
  const sampleRoute = endpoint.optionalAlias && referenceRoute && shape(publicRoute(endpoint.optionalAlias)) === shape(referenceRoute)
    ? endpoint.optionalAlias : endpoint.route;
  const sample = sampleRoute.replace(/\{([^}]+)\}/gu, (_, name) =>
    valueFor(endpoint.parameters?.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? { type: 'string' }));
  const factParts = factRoute.split('/');
  const displayParts = displayRoute.split('/');
  const parameters = (endpoint.parameters ?? []).map((item) => {
    if (item.in !== 'route' || !sameShape) return item;
    const at = factParts.findIndex((part) => part.toLowerCase() === `{${item.name.toLowerCase()}}`);
    return at >= 0 && /^\{\w+\}$/u.test(displayParts[at])
      ? { ...item, name: displayParts[at].slice(1, -1) } : item;
  }).filter((item) => !Array.isArray(page?.paramNames) || page.paramNames.some((name) => name.toLowerCase() === item.name.toLowerCase()));
  const query = parameters.filter((item) => item.in === 'query');
  const bodyFields = parameters.filter((item) => item.in === 'body');
  const requestBody = Object.fromEntries(bodyFields.map((item) => [item.name, /^(?:int|long|double|decimal|float|short|number)$/iu.test(item.type) ? 1 : /^bool(?:ean)?$/iu.test(item.type) ? true : 'abc123']));
  const bodyJson = JSON.stringify(requestBody);
  const queryString = query.length ? `?${query.map((item) => `${encodeURIComponent(item.name)}=${encodeURIComponent(valueFor(item))}`).join('&')}` : '';
  const example = page ?? examples?.find((item) => item.sections?.includes('Exemplo')) ?? examples?.[0];
  const url = `${example?.baseUrl ?? ''}${sample}${queryString}`;
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
      const type = /^(?:int|long|double|decimal|float|short)$/iu.test(item.type) ? 'number'
        : /^bool(?:ean)?$/iu.test(item.type) ? 'boolean' : 'string';
      const required = item.required ?? (item.in === 'route' || (item.in === 'body' && !item.type.endsWith('?')));
      return `<Param name="${safe(item.name)}" type="${type}"${required ? ' required' : ''}>${safe(item.in)} (${safe(item.type)})</Param>`;
    }).join('\n')}\n</Params>`);
  }

  const auth = endpoint.authorization ?? endpoint.policy;
  if (auth && auth !== 'anonymous') add('autorização', `Autorização: envie \`Authorization: Bearer $IHELP_TOKEN\`.${auth.startsWith('role:') ? ` Papel exigido: ${safe(auth.slice(5))}.` : auth === 'authenticated' ? '' : ` Política exigida: ${safe(auth)}.`}`);
  const header = auth && auth !== 'anonymous' ? ' -H "Authorization: Bearer $IHELP_TOKEN"' : '';
  const blocks = [];
  if (languages.has('bash')) blocks.push(`\`\`\`bash\ncurl${endpoint.verb === 'GET' ? '' : ` -X ${endpoint.verb}`} "${url}"${header}${bodyFields.length ? ` -H "Content-Type: application/json" -d '${bodyJson}'` : ''}\n\`\`\``);
  if (languages.has('js')) blocks.push(`\`\`\`js\nconst res = await fetch('${url}', { method: '${endpoint.verb}'${auth && auth !== 'anonymous' ? ", headers: { Authorization: `Bearer ${process.env.IHELP_TOKEN}` }" : ''}${bodyFields.length ? `, body: JSON.stringify(${bodyJson})` : ''} });\n\`\`\``);
  if (languages.has('python')) blocks.push(`\`\`\`python\nimport os, requests\nr = requests.request('${endpoint.verb}', '${url}'${auth && auth !== 'anonymous' ? ', headers={"Authorization": f"Bearer {os.environ[\'IHELP_TOKEN\']}"}' : ''}${bodyFields.length ? `, json=${bodyJson.replace(/\btrue\b/gu, 'True').replace(/\bfalse\b/gu, 'False')}` : ''}, timeout=15)\n\`\`\``);
  if (languages.has('http')) blocks.push(`\`\`\`http\n${endpoint.verb} ${url}\n\`\`\``);
  if (blocks.length) add('exemplo', `## ${heading('exemplo', 'Exemplo')}\n\n${components.has('CodeTabs') ? `<CodeTabs labels={${JSON.stringify([...languages].map((language) => ({ bash: 'cURL', js: 'Node', python: 'Python', http: 'URL' })[language]))}}>\n\n` : ''}${blocks.join('\n\n')}${components.has('CodeTabs') ? '\n\n</CodeTabs>' : ''}`);

  if (endpoint.responseFields === null) add('resposta', `## ${heading('resposta', 'Resposta')}\n\nCampos de resposta ainda não documentados.`);
  else if (fieldsTag) add('campos', `## ${heading('campos relevantes', 'Campos relevantes')}\n\n${components.has('Fields') ? '<Fields>\n' : ''}${endpoint.responseFields.map((field) => `<Field name="${safe(field.name)}">${safe(field.type)}</Field>`).join('\n')}${components.has('Fields') ? '\n</Fields>' : ''}`);
  const order = (kind) => kind === 'autorização' ? -1 : sections.findIndex((section) => section.toLowerCase().startsWith(kind === 'campos' ? 'campos relevantes' : kind));
  const rank = (kind) => kind === 'autorização' ? -1 : order(kind) < 0 ? 100 : order(kind);
  paragraphs.sort((left, right) => rank(left.kind) - rank(right.kind));
  return { source: 'api', contentType: 'referencia', method: endpoint.verb,
    endpoint: displayRoute, body: paragraphs.map((item) => item.body).join('\n\n'),
    pending: endpoint.responseFields === null ? [`campos de resposta não verificáveis: ${endpoint.verb} ${endpoint.route}`] : [] };
}
