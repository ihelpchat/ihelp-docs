import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startQaSite } from './visual/serve-qa-build.mjs';
import { credentialsFromEnv, runGuideProof } from './guide-proof.mjs';
import { envCompatibility } from '../mcp/env-compat.mjs';

const names = envCompatibility.guideProof;
const evidenceDir = resolve(import.meta.dirname, '..', '.guide-proof');
const stagingUrl = process.env[names.stagingUrl];
if (stagingUrl) {
  const result = await runGuideProof({ baseUrl: stagingUrl, evidenceDir, credentials: credentialsFromEnv(), appSha: process.env[names.appSha] });
  console.log(JSON.stringify({ mode: result.mode, authorized: result.authorized, denied: result.denied, qr: result.qr }));
} else {
  console.log('pendente: conta de teste de homologação (Bruno)');
  const root = await mkdtemp(join(tmpdir(), 'guide-proof-fixture-'));
  const routes = { channel: ['abrir-canais', 'conectar'], user: ['abrir-usuarios', 'criar-usuario', 'preencher-dados', 'escolher-departamento', 'revisar-acesso', 'salvar-usuario'], department: ['abrir-departamentos', 'configurar-horario', 'escrever-recado', 'salvar-recado'] };
  let site;
  try {
    for (const [route, steps] of Object.entries(routes)) {
      const dir = join(root, 'configuracoes', route);
      await mkdir(dir, { recursive: true });
      const controls = steps.map(step => /^(preencher|escrever|configurar|escolher|revisar)/u.test(step)
        ? `<input data-proof-step="${step}" />` : `<button data-proof-step="${step}">${step.startsWith('salvar') ? 'Salvar Alterações' : step}</button>`).join('');
      const save = controls.match(/<button data-proof-step="salvar-[^>]+>Salvar Alterações<\/button>/u)?.[0] ?? '';
      await writeFile(join(dir, 'index.html'), `<!doctype html><html><body><main data-tour-id="guide-${route === 'channel' ? 'qr' : route}-open">${controls.replace(save, '')}</main>${save}<script>
        const denied = new URLSearchParams(location.search).get('role') === 'denied';
        const field = document.querySelector('input'), key = 'saved-${route}';
        if (field) field.value = localStorage.getItem(key) || '';
        document.querySelectorAll('button').forEach(button => button.onclick = () => {
          if (button.textContent === 'Salvar Alterações' && !denied) localStorage.setItem(key, field.value);
          else button.dataset.done = 'yes';
        });
      </script></body></html>`);
    }
    site = await startQaSite(root, '');
    const result = await runGuideProof({ baseUrl: site.url, evidenceDir, fixture: true });
    console.log(JSON.stringify({ mode: result.mode, authorized: result.authorized, denied: result.denied, qr: result.qr }));
  } finally {
    await site?.close();
    await rm(root, { recursive: true, force: true });
  }
}
