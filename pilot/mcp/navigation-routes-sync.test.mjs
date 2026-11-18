import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import snapshot from '../architecture/navigation-routes.front.json' with { type: 'json' };
import { widgetContextRoutes } from '../architecture/widget-context.mjs';
import { guideStepRoutes } from '../architecture/conversation-v1.mjs';
assert.equal(snapshot.contentSha256, createHash('sha256').update(JSON.stringify(snapshot.catalog)).digest('hex'));
const expected = [...new Set([...snapshot.catalog.routePaths, ...snapshot.catalog.routes.map(({path}) => path)])];
assert.deepEqual(widgetContextRoutes, expected);
assert.deepEqual(guideStepRoutes, expected);
assert.match(snapshot.frontSha, /^[a-f0-9]{40}$/u);
for (const route of ['/configuracoes/atalhos', '/configuracoes/automacoes', '/configuracoes/motivos']) assert.ok(expected.includes(route));
// CI can compare an independently checked-out front; hashes of all upstream inputs are also checked.
if (process.env.NAVIGATION_FRONT_ROOT) execFileSync(process.execPath, ['scripts/sync-navigation-routes.mjs', process.env.NAVIGATION_FRONT_ROOT, '--revision', snapshot.frontSha, '--check'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' });
console.log('Navigation routes sync OK');
