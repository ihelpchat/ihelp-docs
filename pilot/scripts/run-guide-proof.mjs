import { resolve } from 'node:path';
import { credentialsFromEnv, runGuideProof } from './guide-proof.mjs';
import { envCompatibility } from '../mcp/env-compat.mjs';

const names = envCompatibility.guideProof;
const stagingUrl = process.env[names.stagingUrl];
if (stagingUrl) {
  const result = await runGuideProof({
    baseUrl: stagingUrl,
    evidenceDir: resolve(import.meta.dirname, '..', '.guide-proof'),
    credentials: credentialsFromEnv(),
    appSha: process.env[names.appSha],
  });
  console.log(JSON.stringify({ mode: result.mode, authorized: result.authorized, denied: result.denied, qr: result.qr, warning: result.warning, cleanupPending: result.cleanupPending }));
} else {
  console.log('pendente: conta de teste de homologação (Bruno)');
  await import('../mcp/guide-proof-rework.test.mjs');
  console.log('fixture: passed');
}
