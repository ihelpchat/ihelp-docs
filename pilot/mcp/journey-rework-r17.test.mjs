import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readJourney, saveJourney } from './journey-service.mjs';

const accountHash = 'a'.repeat(64);
const task = 'contatos.cadastrar';
const proof = (companyId) => createHash('sha256').update(JSON.stringify(['user-1', companyId])).digest('hex');

test('ler_jornada revalida a conta no momento da leitura', async () => {
  const root = await mkdtemp(join(tmpdir(), 'journey-r17-read-'));
  try {
    await saveJourney(root, 'contatos', {
      task, status: 'concluída', cacheKey: 'b'.repeat(64),
      configuredIdentityHash: accountHash, accountProof: proof('company-a'), identityVerified: true,
    }, []);
    const options = { root, module: 'contatos', task, accountHash };

    await assert.rejects(readJourney({ ...options,
      probeAccount: async () => ({ userId: 'user-1', companyId: 'company-b' }) }),
    /jornada de outra conta/u);

    const offline = await readJourney({ ...options, probeAccount: async () => null });
    assert.equal(offline.task, task);
    assert.equal(offline.identityVerified, false);

    const online = await readJourney({ ...options,
      probeAccount: async () => ({ userId: 'user-1', companyId: 'company-a' }) });
    assert.equal(online.task, task);
    assert.equal(online.identityVerified, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
