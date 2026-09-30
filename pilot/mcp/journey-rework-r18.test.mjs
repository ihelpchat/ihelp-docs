import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readJourney, saveJourney } from './journey-service.mjs';

const hash = 'a'.repeat(64);
const proof = (company) => createHash('sha256').update(JSON.stringify(['user-1', company])).digest('hex');

async function fixture(accountProof) {
  const root = await mkdtemp(join(tmpdir(), 'journey-r18-'));
  const task = 'contatos.cadastrar';
  await saveJourney(root, 'contatos', { task, status: 'concluída', cacheKey: 'b'.repeat(64),
    configuredIdentityHash: hash, ...(accountProof ? { accountProof } : {}) }, []);
  return { root, module: 'contatos', task, accountHash: hash };
}

test('15 leituras da mesma conta fazem no máximo um login', async () => {
  const options = await fixture(proof('company-a'));
  let logins = 0;
  const probeAccount = async () => { logins++; return { userId: 'user-1', companyId: 'company-a' }; };
  try {
    const results = await Promise.all(Array.from({ length: 15 }, () => readJourney({ ...options, probeAccount })));
    assert.equal(logins, 1);
    assert.ok(results.every((item) => item.identityVerified === true));
  } finally { await rm(options.root, { recursive: true, force: true }); }
});

test('registro sem accountProof é servido sem login', async () => {
  const options = await fixture();
  try {
    const result = await readJourney({ ...options, probeAccount: async () => { throw new Error('login indevido'); } });
    assert.equal(result.identityVerified, false);
    assert.equal(result.accountless, true);
  } finally { await rm(options.root, { recursive: true, force: true }); }
});

test('outra empresa com prova válida não lê a jornada', async () => {
  const options = await fixture(proof('company-a'));
  try {
    await assert.rejects(readJourney({ ...options,
      probeAccount: async () => ({ userId: 'user-1', companyId: 'company-b' }) }), /jornada de outra conta/u);
  } finally { await rm(options.root, { recursive: true, force: true }); }
});

test('falha da prova serve a jornada sem vazar detalhe do login', async () => {
  const options = await fixture(proof('company-a'));
  try {
    const result = await readJourney({ ...options, probeAccount: async () => { throw new Error('email privado e senha'); } });
    assert.equal(result.identityVerified, false);
    assert.equal(result.identityReason, 'login');
    assert.equal(JSON.stringify(result).includes('email privado'), false);
  } finally { await rm(options.root, { recursive: true, force: true }); }
});
