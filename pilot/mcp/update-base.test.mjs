import assert from 'node:assert/strict';
import { atualizarPorDeploy } from './update-by-deploy.mjs';
import { detectRelease } from '../scripts/detect-release.mjs';

const before = { frontSha: 'a'.repeat(40), backSha: 'b'.repeat(40), manifest: { routes: [], labels: [], markers: [], permissions: [] } };
const after = { ...before, frontSha: 'c'.repeat(40) };
const event = (base) => ({ before, after, base, requestedBy: 'service:deploy' });

function fixture() {
  const calls = { package: 0, submit: 0 };
  const guide = { pathSegments: ['docs', 'guide'], guide: { guideId: 'guide', steps: [] } };
  const deps = {
    package: async () => { calls.package++; return { catalog: { guides: [guide] }, sources: {} }; },
    impact: () => ({ pending: [], proposals: [{ kind: 'atualizar', guideId: 'guide', dependency: 'route', reason: 'alterada' }], shas: after }),
    read: async () => ({ path: 'docs/guide', body: 'Guia público de exemplo.' }),
    submit: async (_root, _articles, _mode, _actor, _deletes, options) => {
      calls.submit++;
      assert.equal(options.base, 'integration/claricia-v2');
      return { url: 'https://github.com/ihelpchat/ihelp-docs/pull/1' };
    },
  };
  return { calls, deps, update: (input) => atualizarPorDeploy('/fixture', input, deps) };
}

for (const base of ['integration/claricia-v2', 'main', 'master', 'release/validation', '']) {
  const direct = fixture();
  if (base === 'integration/claricia-v2') {
    await direct.update(event(base));
    assert.equal(direct.calls.submit, 1, 'base de integração aceita no caminho direto');
  } else {
    await assert.rejects(direct.update(event(base)), (error) => {
      assert.equal(error.message, `base não permitida: ${base}`);
      return true;
    });
    assert.deepEqual(direct.calls, { package: 0, submit: 0 }, `${base}: nenhum efeito antes da rejeição direta`);
  }

  const detected = fixture();
  const result = await detectRelease({ beforeFile: 'before', afterFile: 'after', token: 'write', base }, {
    read: async (file) => file === 'before' ? before : after,
    update: detected.update,
  });
  if (base === 'integration/claricia-v2') {
    assert.equal(detected.calls.submit, 1, 'base de integração aceita pelo detector');
  } else {
    assert.match(result.pending.join(' '), new RegExp(`base não permitida: ${base}`));
    assert.deepEqual(detected.calls, { package: 0, submit: 0 }, `${base}: detector não escreve`);
  }
}
console.log('Base de update automático: allowlist aplicada no detector e na escrita');
