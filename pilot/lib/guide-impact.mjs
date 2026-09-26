const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const canonical = (value) => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => compare(a, b))) : item);
const unique = (items) => [...new Map(items.map((item) => [canonical(item), item])).values()]
  .sort((a, b) => compare(canonical(a), canonical(b)));
const keyOf = {
  route: (item) => item.path,
  marker: (item) => `${item.kind}:${item.id}`,
  label: (item) => item.label,
  permission: (item) => `${item.controller}.${item.method}:${item.verb}:${item.route}`,
};
const manifestField = { route: 'routes', marker: 'markers', label: 'labels', permission: 'permissions' };
const validSha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const validSnapshot = (value) => value && validSha(value.frontSha) && validSha(value.backSha) &&
  Object.values(manifestField).every((field) => Array.isArray(value.manifest?.[field]));

export function buildGuideReferenceIndex(guides, actions) {
  return guides.map(({ guide }) => {
    const references = [];
    for (const step of guide.steps) {
      const action = actions[step.actionId];
      if (action?.route) references.push({ kind: 'route', key: action.route });
      if (action?.target) references.push({ kind: 'marker', key: `tour:${action.target}` });
      if (action?.label) references.push({ kind: 'label', key: action.label });
      for (const ref of step.references ?? []) {
        if (!keyOf[ref.kind] || typeof ref.key !== 'string' || !ref.key) throw new Error(`${guide.guideId}: referência inválida`);
        references.push(ref);
      }
    }
    return { guideId: guide.guideId, references: unique(references) };
  }).sort((a, b) => compare(a.guideId, b.guideId));
}

export function calculateGuideImpact({ before, after, guides, actions }) {
  const index = buildGuideReferenceIndex(guides, actions);
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
