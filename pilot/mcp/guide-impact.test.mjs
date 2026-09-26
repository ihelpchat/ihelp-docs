import assert from 'node:assert/strict';
import { calculateGuideImpact } from '../lib/guide-impact.mjs';

const sha = (character) => character.repeat(40);
const endpoint = { controller: 'ChannelsController', method: 'Read', verb: 'GET', route: 'api/channel', policy: 'Channels.Read', name: 'Channels.Read' };
const manifest = {
  routes: [{ path: '/channels', label: 'Canais' }, { path: '/users', label: 'Usuários' }],
  labels: [{ label: 'Conectar', file: 'src/Channel.tsx' }, { label: 'Adicionar pessoa', file: 'src/User.tsx' }],
  markers: [{ kind: 'tour', id: 'connect' }, { kind: 'tour', id: 'add-user' }],
  permissions: [endpoint],
};
const snapshot = (frontSha, backSha, data = manifest) => ({ frontSha: sha(frontSha), backSha: sha(backSha), manifest: data });
const before = snapshot('a', 'b');
const guides = [
  { guide: { guideId: 'connect-guide', steps: [{ stepId: 'open', actionId: 'open-channel' }] } },
  { guide: { guideId: 'user-guide', steps: [{ stepId: 'open', actionId: 'open-user' }] } },
];
const sources = {
  'connect-guide': [{ stepId: 'open', side: 'front', file: 'src/Channel.tsx', line: 12, target: 'Conectar' },
    { stepId: 'open', side: 'back', file: 'Controllers/ChannelsController.cs', line: 12, target: 'Read' }],
  'user-guide': [{ stepId: 'open', side: 'front', file: 'src/User.tsx', line: 20, target: 'Adicionar pessoa' }],
};
const actions = {
  'open-channel': { route: '/channels', target: 'connect' },
  'open-user': { route: '/users', target: 'add-user' },
};
const run = (after, old = before) => calculateGuideImpact({ before: old, after, guides, actions, sources });
const proposal = (result, guideId, kind) => result.proposals.find((item) => item.guideId === guideId && item.kind === kind);
const changed = (field, value) => snapshot('c', 'd', { ...manifest, [field]: value });

const labelChanged = run(changed('labels', [{ label: 'Reconectar', file: 'src/Channel.tsx' }, manifest.labels[1]]));
assert.ok(proposal(labelChanged, 'connect-guide', 'atualizar'), 'rótulo alterado deve impactar o guia associado');
assert.ok(!labelChanged.proposals.some((item) => item.guideId === 'user-guide'), 'outro guia fica fora');
assert.deepEqual(labelChanged.index.find((item) => item.guideId === 'connect-guide').references.filter((item) => item.kind === 'label'),
  [{ kind: 'label', key: 'src/Channel.tsx:Conectar', file: 'src/Channel.tsx', line: 12 }], 'índice preserva fonte exata');

const routeChanged = run(changed('routes', [{ path: '/connections', label: 'Canais' }, manifest.routes[1]]));
assert.ok(proposal(routeChanged, 'connect-guide', 'avisar'), 'rota removida vira aviso, sem excluir guia');
assert.ok(routeChanged.proposals.some((item) => item.kind === 'criar' && item.key === '/connections'), 'rota nova sem cobertura vira candidata');
assert.ok(!routeChanged.proposals.some((item) => item.kind === 'excluir'), 'impacto nunca apaga conteúdo');

const permissionChanged = run(changed('permissions', [{ ...endpoint, policy: 'Channels.Manage' }]));
assert.ok(proposal(permissionChanged, 'connect-guide', 'atualizar'), 'permissão alterada afeta guia com referência explícita');
assert.ok(!permissionChanged.proposals.some((item) => item.guideId === 'user-guide'));

const markerChanged = run(changed('markers', [manifest.markers[1]]));
assert.ok(proposal(markerChanged, 'connect-guide', 'avisar'), 'marcador removido gera aviso');

const noSnapshot = run(undefined);
assert.deepEqual(noSnapshot.proposals, []);
assert.ok(noSnapshot.pending.some((item) => item.includes('snapshot')));
assert.deepEqual(run(changed('labels', manifest.labels)), run(changed('labels', manifest.labels)), 'mesmo par de SHAs reproduz resultado');
assert.equal(JSON.stringify(labelChanged), JSON.stringify(run(changed('labels', [{ label: 'Reconectar', file: 'src/Channel.tsx' }, manifest.labels[1]]))), 'replay byte a byte');
const noProof = run(changed('permissions', [{ ...endpoint, policy: 'Channels.Manage' }]), before);
assert.ok(noProof.proposals.some((item) => item.guideId === 'connect-guide' && item.dependency === 'permission'));
const unrelatedGuide = [{ guide: { guideId: 'user-guide', steps: [{ stepId: 'open', actionId: 'open-user' }] } }];
const unrelated = calculateGuideImpact({ before, after: changed('permissions', [{ ...endpoint, policy: 'Channels.Manage' }]),
  guides: unrelatedGuide, actions, sources });
assert.ok(!unrelated.proposals.some((item) => item.dependency === 'permission'));
assert.ok(unrelated.info.some((item) => item.includes('user-guide: permissão não mapeada')));

const missingSource = { ...sources, 'user-guide': [{ stepId: 'open', side: 'front', file: 'src/User.tsx', line: 23, target: 'Rótulo ausente' }] };
const missing = calculateGuideImpact({ before, after: changed('labels', manifest.labels), guides, actions, sources: missingSource });
assert.ok(missing.pending.some((item) => item.includes('user-guide') && item.includes('open') &&
  item.includes('src/User.tsx:23') && item.includes('rótulo da fonte não encontrado no manifest') && item.includes('anterior')));
assert.ok(missing.pending.some((item) => item.includes('atual')));
console.log('Guide impact test OK');
