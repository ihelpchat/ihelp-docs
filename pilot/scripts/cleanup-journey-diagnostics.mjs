import { readdir, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const screenshotPattern = /^[a-f0-9]{64}$/u;
const companyPattern = /^[a-z0-9-]{1,80}$/iu;

// Run against the staging MCP_STATE_DIR. Dry run is the default.
export async function cleanupJourneyDiagnostics({ root, screenshotIds, companyId, apply = false }) {
  if (!root || !companyPattern.test(companyId ?? '') || !Array.isArray(screenshotIds)
    || screenshotIds.length === 0 || screenshotIds.some((id) => !screenshotPattern.test(id)))
    throw new Error('parâmetros de limpeza inválidos');
  const storage = resolve(root);
  const files = [];
  for (const id of new Set(screenshotIds)) {
    const name = join(storage, 'login', `${id}.png`);
    try { await readFile(name); files.push(name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  let confirmations = 0;
  // Confirmation records, if persisted by the runner, are JSON under journeys/confirmations.
  const confirmationDir = join(storage, 'confirmations');
  let entries;
  try { entries = await readdir(confirmationDir, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-z0-9._-]+\.json$/iu.test(entry.name)) continue;
    const name = join(confirmationDir, entry.name);
    const record = JSON.parse(await readFile(name, 'utf8'));
    if (record?.mode !== 'confirmacao' || !companyPattern.test(String(record.companyId ?? ''))
      || String(record.companyId) === companyId) continue;
    files.push(name);
    confirmations++;
  }
  if (apply) for (const name of files) await unlink(name);
  return { screenshots: files.length - confirmations, confirmations, applied: apply };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const screenshotIds = args.flatMap((arg, index) => arg === '--screenshot-id' ? [args[index + 1]] : []);
  if (args.some((arg) => !['--root', '--company-id', '--screenshot-id', '--apply'].includes(arg)
    && ![value('--root'), value('--company-id'), ...screenshotIds].includes(arg)))
    throw new Error('parâmetros de limpeza inválidos');
  const result = await cleanupJourneyDiagnostics({ root: value('--root'),
    companyId: value('--company-id'), screenshotIds, apply: args.includes('--apply') });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
