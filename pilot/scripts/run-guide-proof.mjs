import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startQaSite } from './visual/serve-qa-build.mjs';
import { credentialsFromEnv, runGuideProof } from './guide-proof.mjs';
import { envCompatibility } from '../mcp/env-compat.mjs';

const names = envCompatibility.guideProof;
const evidenceDir = resolve(import.meta.dirname, '..', '.guide-proof');
const stagingUrl = process.env[names.stagingUrl];
const credentials = credentialsFromEnv();

if (stagingUrl) {
  const result = await runGuideProof({ baseUrl: stagingUrl, evidenceDir, credentials, appSha: process.env[names.appSha] });
  console.log(JSON.stringify({ mode: result.mode, authorized: result.authorized, denied: result.denied, qr: result.qr }));
} else {
  console.log('pendente: conta de teste de homologação (Bruno)');
  const root = await mkdtemp(join(tmpdir(), 'guide-proof-fixture-'));
  const pages = [
    ['configuracoes/channel', 'guide-qr-open', 'Conectar'],
    ['configuracoes/user', 'guide-user-open', 'Novo usuário'],
    ['configuracoes/department', 'guide-department-open', 'Salvar Alterações'],
  ];
  let site;
  try {
    for (const [route, marker, label] of pages) {
      const dir = join(root, route);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'index.html'), `<!doctype html><html><body><main data-tour-id="${marker}"><button>${label}</button></main>
      <script>window.fixtureWrites=0;const button=document.querySelector('button');if(new URLSearchParams(location.search).get('role')==='denied')button.disabled=true;button.onclick=()=>window.fixtureWrites++</script></body></html>`);
    }
    site = await startQaSite(root, '');
    const result = await runGuideProof({ baseUrl: site.url, evidenceDir, fixture: true });
    console.log(JSON.stringify({ mode: result.mode, authorized: result.authorized, denied: result.denied, qr: result.qr }));
  } finally {
    await site?.close();
    await rm(root, { recursive: true, force: true });
  }
}
