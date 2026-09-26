import assert from 'node:assert/strict';
import { calculateGuideImpact } from '../lib/guide-impact.mjs';

const sha = (character) => character.repeat(40);
const endpoint = { controller: 'ChannelController', method: 'Read', verb: 'GET', route: 'api/channel', policy: 'Channels.Read', name: 'Channels.Read' };
const manifest = {
  routes: [{ path: '/channels', label: 'Canais' }, { path: '/users', label: 'Usuários' }],
  labels: [{ label: 'Conectar' }, { label: 'Adicionar pessoa' }],
  markers: [{ kind: 'tour', id: 'connect' }, { kind: 'tour', id: 'add-user' }],
  permissions: [endpoint],
};
const snapshot = (frontSha, backSha, data = manifest) => ({ frontSha: sha(frontSha), backSha: sha(backSha), manifest: data });
const before = snapshot('a', 'b');
const guides = [
  { guide: { guideId: 'connect-guide', steps: [{ stepId: 'open', actionId: 'open-channel', references: [
    { kind: 'label', key: 'Conectar', file: 'src/Channel.tsx', line: 12 },
    { kind: 'permission', key: 'ChannelController.Read:GET:api/channel', file: 'Controllers/ChannelController.cs', line: 18 },
  ] }] } },
  { guide: { guideId: 'user-guide', steps: [{ stepId: 'open', actionId: 'open-user', references: [
    { kind: 'label', key: 'Adicionar pessoa', file: 'src/User.tsx', line: 20 },
  ] }] } },
];
const actions = {
  'open-channel': { route: '/channels', target: 'connect' },
  'open-user': { route: '/users', target: 'add-user' },
};
const run = (after, old = before) => calculateGuideImpact({ before: old, after, guides, actions });
const proposal = (result, guideId, kind) => result.proposals.find((item) => item.guideId === guideId && item.kind === kind);
const changed = (field, value) => snapshot('c', 'd', { ...manifest, [field]: value });

const labelChanged = run(changed('labels', [{ label: 'Reconectar' }, manifest.labels[1]]));
assert.ok(proposal(labelChanged, 'connect-guide', 'atualizar'), 'rótulo alterado deve impactar o guia associado');
assert.ok(!labelChanged.proposals.some((item) => item.guideId === 'user-guide'), 'outro guia fica fora');
assert.deepEqual(labelChanged.index.find((item) => item.guideId === 'connect-guide').references.filter((item) => item.kind === 'label'),
  [{ kind: 'label', key: 'Conectar', file: 'src/Channel.tsx', line: 12 }], 'índice preserva fonte exata');

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
assert.equal(JSON.stringify(labelChanged), JSON.stringify(run(changed('labels', [{ label: 'Reconectar' }, manifest.labels[1]]))), 'replay byte a byte');
console.log('Guide impact test OK');
