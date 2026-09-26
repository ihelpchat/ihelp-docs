import assert from 'node:assert/strict';
import { detectRelease, formatSummary } from '../scripts/detect-release.mjs';

const sha = (char) => char.repeat(40);
const approved = { frontSha: sha('a'), backSha: sha('b'), manifest: { routes: [], labels: [], markers: [], permissions: [] } };
const current = { ...approved, frontSha: sha('c') };
const fixture = (after = current) => {
  const calls = [];
  const writes = new Set();
  const deps = {
    read: async (path) => path === 'approved' ? approved : after,
    update: async (input) => {
      calls.push(input);
      writes.add(`${input.after.frontSha}:${input.after.backSha}`);
      return { status: 'propostas', proposals: [{ reused: calls.length > 1 }], pending: [] };
    },
  };
  return { deps, calls, writes };
};

const same = fixture(approved);
const unchanged = await detectRelease({ beforeFile: 'approved', afterFile: 'current', token: 'write', base: 'integration/claricia-v2' }, same.deps);
assert.equal(unchanged.status, 'sem versão nova');
assert.equal(same.calls.length, 0, 'SHA aprovado não chama impacto');

const pendingSame = fixture({ ...approved, pending: ['reconnect: marcador ausente channel-connect'] });
const pendingUnchanged = await detectRelease({ beforeFile: 'approved', afterFile: 'current', token: 'write', base: 'integration/claricia-v2' }, pendingSame.deps);
assert.equal(pendingUnchanged.exitCode, 1, 'pendência do mapa com SHA repetido falha o job');
assert.match(formatSummary(pendingUnchanged), /reconnect: marcador ausente channel-connect/, 'resumo preserva a pendência');
assert.equal(pendingSame.calls.length, 0, 'SHA aprovado não chama impacto mesmo com pendência');
assert.equal(unchanged.exitCode, 0);
assert.match(formatSummary(unchanged), /sem versão nova/);

const changed = fixture();
const options = { beforeFile: 'approved', afterFile: 'current', token: 'write', base: 'integration/claricia-v2' };
const first = await detectRelease(options, changed.deps);
const second = await detectRelease(options, changed.deps);
assert.equal(first.status, 'propostas');
assert.equal(second.status, 'propostas');
assert.equal(changed.calls.length, 2, 'repetição deve consultar a M5.39 para reaproveitar a PR');
assert.equal(changed.writes.size, 1, 'rodar duas vezes com mesmo SHA não cria segunda proposta');
assert.deepEqual(changed.calls[0].before, approved);
assert.deepEqual(changed.calls[0].after, current);
assert.equal(changed.calls[0].base, options.base);

const failed = fixture();
failed.deps.read = async () => { throw Error('checkout indisponível'); };
const readFailure = await detectRelease(options, failed.deps);
assert.equal(readFailure.exitCode, 1);
assert.match(readFailure.pending.join(' '), /leitura.*checkout indisponível/i);
assert.equal(failed.calls.length, 0);

for (const missing of ['token', 'base']) {
  const absent = fixture();
  const result = await detectRelease({ ...options, [missing]: '' }, absent.deps);
  assert.equal(result.exitCode, 0, `${missing} ausente é pendência de configuração`);
  assert.match(result.pending.join(' '), new RegExp(missing === 'token' ? 'DOCS_WRITE_TOKEN' : 'DOCS_UPDATE_BASE'));
  assert.equal(absent.calls.length, 0);
}
console.log('Detecção de versão: idempotência, leitura e configuração OK');
