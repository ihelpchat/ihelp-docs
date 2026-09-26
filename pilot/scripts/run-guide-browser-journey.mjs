import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'guide-qa-build-'));
const isolated = join(temp, 'pilot');
const assistantUrl = 'https://guide-qa.invalid/assistant';
try {
  await mkdir(isolated);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['node_modules', '.next', 'out'].includes(entry.name) || entry.name.startsWith('.env')) continue;
    await cp(join(source, entry.name), join(isolated, entry.name), { recursive: true, force: true });
  }
  await symlink(join(source, 'node_modules'), join(isolated, 'node_modules'), 'dir');
  const env = { ...process.env, NEXT_PUBLIC_ASSISTANT_URL: assistantUrl,
    GUIDE_QA_ASSISTANT_URL: assistantUrl, GUIDE_QA_OUT: join(isolated, 'out') };
  const build = spawnSync(process.execPath, [join(source, 'node_modules/next/dist/bin/next'), 'build', '--webpack'],
    { cwd: isolated, env, stdio: 'inherit' });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exitCode = build.status ?? 1;
  else {
    const journey = spawnSync(process.execPath, [join(source, 'scripts/guide-browser-journey.mjs')],
      { cwd: source, env, stdio: 'inherit' });
    if (journey.error) throw journey.error;
    if (journey.status !== 0) process.exitCode = journey.status ?? 1;
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
