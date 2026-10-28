import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function reviewJourneyPrint({ root, screenshotId, decision }) {
  if (!/^[a-f0-9]{64}$/u.test(screenshotId ?? '') || !['aprovado', 'recusado'].includes(decision))
    throw new Error('revisão inválida');
  let updated = 0;
  const changes = [];
  for (const section of ['contatos', 'robos']) {
    const dir = join(root, section);
    let files;
    try { files = await readdir(dir); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const bytes = await readFile(join(dir, `${screenshotId}.png`)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!bytes) continue;
    if (createHash('sha256').update(bytes).digest('hex') !== screenshotId) throw new Error('print divergente');
    for (const file of files.filter((name) => name.endsWith('.json') && !name.startsWith('cleanup-'))) {
      const path = join(dir, file);
      const record = JSON.parse(await readFile(path, 'utf8'));
      let changed = false;
      for (const screen of record.screens ?? []) {
        if (screen.screenshotId !== screenshotId) continue;
        if (screen.aprovacao !== 'pendente') throw new Error('print sem aprovação pendente');
        screen.aprovacao = decision;
        updated++;
        changed = true;
      }
      if (changed) changes.push({ path, record });
    }
  }
  if (!updated) throw new Error('print pendente não encontrado');
  for (const { path, record } of changes)
    await writeFile(path, JSON.stringify(record, null, 2), { mode: 0o600 });
  return { screenshotId, decision, records: updated };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const [screenshotId, decision] = process.argv.slice(2);
  const root = resolve(process.env.MCP_STATE_DIR ?? '/data', 'journeys');
  reviewJourneyPrint({ root, screenshotId, decision }).then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
