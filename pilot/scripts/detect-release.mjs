import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atualizarPorDeploy, assertAllowedUpdateBase } from '../mcp/update-by-deploy.mjs';

const root = resolve(import.meta.dirname, '..');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const validSha = (value) => /^[a-f0-9]{40}$/i.test(value ?? '');
const validManifest = (value) => value && ['routes', 'labels', 'markers', 'permissions'].every((key) => Array.isArray(value[key]));

export async function detectRelease({ beforeFile, afterFile, proofFile, token, base }, deps = {}) {
  const pending = [];
  if (!token) pending.push('DOCS_WRITE_TOKEN não configurado');
  if (!base) pending.push('DOCS_UPDATE_BASE não configurada; base não permitida: ');
  if (pending.length) return { status: 'pendente', pending, proposals: [], exitCode: 0 };
  try {
    assertAllowedUpdateBase(base);
  } catch (error) {
    return { status: 'pendente', pending: [error.message], proposals: [], exitCode: 1 };
  }
  let before;
  let after;
  let prova;
  try {
    [before, after] = await Promise.all([(deps.read ?? json)(beforeFile), (deps.read ?? json)(afterFile)]);
    if (![before.frontSha, before.backSha, after.frontSha, after.backSha].every(validSha)) throw Error('SHA inválido no snapshot');
    if (!validManifest(before.manifest) || !validManifest(after.manifest)) throw Error('manifest inválido no snapshot');
    if (proofFile) prova = await (deps.read ?? json)(proofFile);
  } catch (error) {
    return { status: 'pendente', pending: [`leitura do snapshot falhou: ${error.message}`], proposals: [], exitCode: 1 };
  }
  if (before.frontSha === after.frontSha && before.backSha === after.backSha) {
    return { status: 'sem versão nova', pending: [], proposals: [], exitCode: 0, shas: { frontSha: after.frontSha, backSha: after.backSha } };
  }
  try {
    const result = await (deps.update ?? ((input) => atualizarPorDeploy(root, input)))({ before, after, prova, base, requestedBy: 'service:deploy' });
    const allPending = [...(after.pending ?? []).map((reason) => `mapa: ${reason}`), ...(result.pending ?? [])];
    return { ...result, status: allPending.length ? 'pendente' : result.status, pending: allPending, exitCode: 0 };
  } catch (error) {
    return { status: 'pendente', pending: [`atualização falhou: ${error.message}`], proposals: [], exitCode: 1 };
  }
}

export function formatSummary(result) {
  const lines = [`## Versão do produto: ${result.status}`];
  if (result.shas) lines.push(`Front: ${result.shas.frontSha}; back: ${result.shas.backSha}.`);
  for (const item of result.proposals ?? []) lines.push(`- PR: ${item.url ?? item.branch}${item.reused ? ' (reutilizada)' : ''}`);
  for (const reason of result.pending ?? []) lines.push(`- Pendente: ${reason}`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [beforeFile, afterFile, proofFile] = process.argv.slice(2);
  if (!beforeFile || !afterFile) throw Error('Uso: detect-release.mjs BEFORE AFTER [PROOF]');
  const result = await detectRelease({ beforeFile, afterFile, proofFile, token: process.env.GITHUB_TOKEN, base: process.env.DOCS_UPDATE_BASE });
  const summary = formatSummary(result);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exitCode = result.exitCode;
}
