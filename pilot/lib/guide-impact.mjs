const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const canonical = (value) => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => compare(a, b))) : item);
const unique = (items) => [...new Map(items.map((item) => [canonical(item), item])).values()]
  .sort((a, b) => compare(canonical(a), canonical(b)));
const keyOf = {
  route: (item) => item.path,
  marker: (item) => `${item.kind}:${item.id}`,
  label: (item) => item.file ? `${item.file}:${item.label}` : item.label,
  permission: (item) => `${item.controller}.${item.method}:${item.verb}:${item.route}`,
};
const manifestField = { route: 'routes', marker: 'markers', label: 'labels', permission: 'permissions' };
const validSha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const itemFields = {
  routes: ['path', 'label'], labels: ['label', 'file'], markers: ['kind', 'id'],
  permissions: ['controller', 'method', 'verb', 'route', 'policy', 'name'],
};
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function snapshotIssue(value, name) {
  if (!record(value)) return `${name}: snapshot inválido em snapshot`;
  for (const field of ['frontSha', 'backSha']) {
    if (!validSha(value[field])) return `${name}: snapshot inválido em ${field}`;
  }
  if (!record(value.manifest)) return `${name}: snapshot inválido em manifest`;
  for (const [field, required] of Object.entries(itemFields)) {
    if (!Array.isArray(value.manifest[field])) return `${name}: snapshot inválido em manifest.${field}`;
    for (const [index, item] of value.manifest[field].entries()) {
      const path = `manifest.${field}[${index}]`;
      if (!record(item)) return `${name}: snapshot inválido em ${path}`;
      for (const key of required) {
        if (typeof item[key] !== 'string' || !item[key].trim()) return `${name}: snapshot inválido em ${path}.${key}`;
      }
    }
  }
  return null;
}
const normalizedLabel = (value) => value.normalize('NFD').replace(/\p{M}/gu, '')
  .toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim();
const labelKey = ({ file, label }) => `${file}:${normalizedLabel(label)}`;
const provedPermission = (source, endpoint) => source.side === 'back' && source.line > 0 &&
  source.file.split('/').at(-1) === `${endpoint.controller}.cs` && source.target === endpoint.method;

export function buildGuideReferenceIndex(guides, actions, sources = {}, manifest = {}) {
  return guides.map(({ guide }) => {
    const references = [];
    const guideSources = sources[guide.guideId] ?? [];
    for (const step of guide.steps) {
      const action = actions[step.actionId];
      if (action?.route) references.push({ kind: 'route', key: action.route });
      if (action?.target) references.push({ kind: 'marker', key: `tour:${action.target}` });
      for (const source of guideSources.filter((item) => item.stepId === step.stepId && item.side === 'front')) {
        references.push({ kind: 'label', key: `${source.file}:${source.target}`, file: source.file, line: source.line });
        for (const marker of manifest.markers ?? []) {
          if (marker.id === source.target) references.push({ kind: 'marker', key: keyOf.marker(marker) });
        }
      }
    }
    for (const endpoint of manifest.permissions ?? []) {
      if (guideSources.some((source) => provedPermission(source, endpoint))) {
        references.push({ kind: 'permission', key: keyOf.permission(endpoint) });
      }
    }
    return { guideId: guide.guideId, references: unique(references) };
  }).sort((a, b) => compare(a.guideId, b.guideId));
}

export function calculateGuideImpact({ before, after, guides, actions, sources }) {
  const issues = [snapshotIssue(before, 'snapshot anterior'), snapshotIssue(after, 'snapshot atual')].filter(Boolean);
  const index = buildGuideReferenceIndex(guides, actions, sources, issues.length ? {} : before.manifest);
  const shas = { before: before ? { frontSha: before.frontSha, backSha: before.backSha } : null,
    after: after ? { frontSha: after.frontSha, backSha: after.backSha } : null };
  const info = index.filter(({ references }) => !references.some(({ kind }) => kind === 'permission'))
    .map(({ guideId }) => `${guideId}: permissão não mapeada`);
  if (issues.length) {
    return { shas, index, proposals: [], pending: issues, info };
  }
  const proposals = [];
  const pending = [];
  for (const { guideId } of index) for (const source of sources?.[guideId] ?? []) {
    if (source.side !== 'front') continue;
    for (const [version, snapshot] of [['anterior', before], ['atual', after]]) {
      if (!snapshot.manifest.labels.some((label) => labelKey(label) === labelKey({ file: source.file, label: source.target }))) {
        pending.push(`${guideId} ${source.stepId} ${source.file}:${source.line}: rótulo da fonte não encontrado no manifest ${version}`);
      }
    }
  }
  const coveredRoutes = new Set(index.flatMap(({ references }) => references.filter(({ kind }) => kind === 'route').map(({ key }) => key)));
  for (const kind of Object.keys(manifestField).sort(compare)) {
    const field = manifestField[kind];
    const itemKey = kind === 'label' ? labelKey : keyOf[kind];
    const oldItems = new Map(before.manifest[field].map((item) => [itemKey(item), item]));
    const newItems = new Map(after.manifest[field].map((item) => [itemKey(item), item]));
    for (const { guideId, references } of index) {
      for (const ref of references.filter((item) => item.kind === kind)) {
        const lookup = kind === 'label' ? labelKey({ file: ref.file, label: ref.key.slice(ref.file.length + 1) }) : ref.key;
        const old = oldItems.get(lookup);
        const current = newItems.get(lookup);
        if (!old) {
          pending.push(`${guideId}: ${kind} ${ref.key} ausente no snapshot anterior`);
          continue;
        }
        if (canonical(old) === canonical(current)) continue;
        proposals.push({ kind: current || kind === 'label' ? 'atualizar' : 'avisar', guideId, dependency: kind, key: ref.key,
          reason: current ? 'alterado' : 'removido' });
      }
    }
    if (kind === 'route') for (const [key] of newItems) {
      if (!oldItems.has(key) && !coveredRoutes.has(key)) proposals.push({ kind: 'criar', key, dependency: 'route', reason: 'sem guia' });
    }
  }
  return { shas, index, proposals: unique(proposals), pending: [...new Set(pending)].sort(compare), info };
}
