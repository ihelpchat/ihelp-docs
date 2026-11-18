import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const fixture = await mkdtemp(join(tmpdir(), 'navigation-sync-'));
try {
 const input='export const routes = [];\n';
 const source='src/features/help-assistant/navigation-routes.generated.json';
 await mkdir(join(fixture,'src/features/help-assistant'),{recursive:true});
 await writeFile(join(fixture,'src/routes.ts'),input);
 const catalog={schemaVersion:1,routePaths:['/fixture'],routes:[{path:'/fixture'}],sources:{'src/routes.ts':createHash('sha256').update(input).digest('hex')}};
 await writeFile(join(fixture,source),JSON.stringify(catalog));
 const git=(...args)=>execFileSync('git',['--no-pager','-C',fixture,...args],{stdio:'pipe'});
 git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','fixture');
 const output=join(fixture,'snapshot.json');
 const run=(...extra)=>execFileSync(process.execPath,[new URL('../scripts/sync-navigation-routes.mjs',import.meta.url).pathname,fixture,'--output',output,...extra],{stdio:'pipe'});
 run();run('--check');
 await writeFile(output,(await readFile(output,'utf8')).replace('/fixture','/divergent'));
 assert.throws(()=>run('--check'),'drift must fail');
 catalog.sources['src/routes.ts']='invalid';
 await writeFile(join(fixture,source),JSON.stringify(catalog));git('add',source);git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-m','stale generated source');
 assert.throws(()=>run(),'outdated upstream generator inputs must fail');
} finally { await rm(fixture,{recursive:true,force:true}); }
console.log('Navigation routes sync OK');
