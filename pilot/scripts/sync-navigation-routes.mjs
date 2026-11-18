// Read-only front → docs sync. --check never writes either repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const front = args[0];
assert.ok(front, 'Informe o checkout local do front.');
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const revision = option('--revision', 'HEAD');
const output = resolve(option('--output', new URL('../architecture/navigation-routes.front.json', import.meta.url).pathname));
const git = (...params) => execFileSync('git', ['--no-pager', '-C', front, ...params], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
const frontSha = git('rev-parse', `${revision}^{commit}`).trim();
const path = 'src/features/help-assistant/navigation-routes.generated.json';
const raw = git('show', `${frontSha}:${path}`);
const catalog = JSON.parse(raw);
assert.equal(catalog.schemaVersion, 1);
assert.ok(catalog.routePaths.length && new Set(catalog.routePaths).size === catalog.routePaths.length);
for (const [file, digest] of Object.entries(catalog.sources)) {
  assert.equal(createHash('sha256').update(git('show', `${frontSha}:${file}`)).digest('hex'), digest, `Catálogo do front desatualizado: ${file}`);
}
const snapshot = { schemaVersion: 1, frontSha, source: path, contentSha256: createHash('sha256').update(JSON.stringify(catalog)).digest('hex'), catalog };
const content = JSON.stringify(snapshot, null, 2) + '\n';
if (args.includes('--check')) assert.equal(await readFile(output, 'utf8'), content, 'Catálogo docs diverge do front; execute sync-navigation-routes.mjs.');
else await writeFile(output, content);
console.log(`Navigation catalog: ${frontSha}; ${catalog.routePaths.length} canonical routes; ${args.includes('--check') ? 'checked' : 'synced'}`);
