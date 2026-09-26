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
const validSnapshot = (value) => value && validSha(value.frontSha) && validSha(value.backSha) &&
  Object.values(manifestField).every((field) => Array.isArray(value.manifest?.[field]));

export function buildGuideReferenceIndex(guides, actions, sources = {}, manifest = {}) {
  return guides.map(({ guide }) => {
    const references = [];
    const guideSources = sources[guide.guideId] ?? [];
    for (const step of guide.steps) {
      const action = actions[step.actionId];
      if (action?.route) references.push({ kind: 'route', key: action.route });
      if (action?.target) references.push({ kind: 'marker', key: `tour:${action.target}` });
      for (const source of guideSources.filter((item) => item.stepId === step.stepId && item.side === 'front')) {
        if (manifest.labels?.some(({ label, file }) => label === source.target && file === source.file)) {
          references.push({ kind: 'label', key: `${source.file}:${source.target}`, file: source.file, line: source.line });
        }
        for (const marker of manifest.markers ?? []) {
          if (marker.id === source.target) references.push({ kind: 'marker', key: keyOf.marker(marker) });
        }
      }
    }
    const routes = new Set(references.filter(({ kind }) => kind === 'route').map(({ key }) => key.split('/').at(-1)?.toLowerCase()));
    for (const endpoint of manifest.permissions ?? []) {
      if ([...routes].some((area) => area && endpoint.controller.toLowerCase().includes(area))) {
        references.push({ kind: 'permission', key: keyOf.permission(endpoint) });
      }
    }
    return { guideId: guide.guideId, references: unique(references) };
  }).sort((a, b) => compare(a.guideId, b.guideId));
}

export function calculateGuideImpact({ before, after, guides, actions, sources }) {
  const index = buildGuideReferenceIndex(guides, actions, sources, before?.manifest);
  const shas = { before: before ? { frontSha: before.frontSha, backSha: before.backSha } : null,
    after: after ? { frontSha: after.frontSha, backSha: after.backSha } : null };
  if (!validSnapshot(before) || !validSnapshot(after)) {
    return { shas, index, proposals: [], pending: ['snapshot anterior ou atual ausente ou inválido'] };
  }
  const proposals = [];
  const pending = [];
  const coveredRoutes = new Set(index.flatMap(({ references }) => references.filter(({ kind }) => kind === 'route').map(({ key }) => key)));
  for (const kind of Object.keys(manifestField).sort(compare)) {
    const field = manifestField[kind];
    const oldItems = new Map(before.manifest[field].map((item) => [keyOf[kind](item), item]));
    const newItems = new Map(after.manifest[field].map((item) => [keyOf[kind](item), item]));
    for (const { guideId, references } of index) {
      for (const ref of references.filter((item) => item.kind === kind)) {
        const old = oldItems.get(ref.key);
        const current = newItems.get(ref.key);
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
  return { shas, index, proposals: unique(proposals), pending: [...new Set(pending)].sort(compare) };
}
