import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcileHumanUpdate, MCP_GIT_AUTHOR } from './human-edits.mjs';

for (const humanResolution of [false, true]) {
for (const botFirstParent of [false, true]) {
const root = await mkdtemp(join(tmpdir(), 'merge-probe-'));
const git=(...args)=>execFileSync('git',['--no-pager',...args],{cwd:root,encoding:'utf8'}).trim();
const path='example.mdx';
async function commit(text,message,human=false){await writeFile(join(root,path),text);git('add',path);git(...(human?['-c','user.name=Editor','-c','user.email=editor@example.test']:[]),'commit','-qm',message);}
try {
 git('init','-q');git('config','user.name',MCP_GIT_AUTHOR.name);git('config','user.email',MCP_GIT_AUTHOR.email);git('commit','--allow-empty','-qm','seed');
 const original=`---\ntitle: Exemplo\nmcpGeneratedSha: ${git('rev-parse','HEAD')}\n---\n\n## Produto\n\nProduto v1.\n\n## Humana\n\nTexto original.\n\n## Resolução\n\nResolução original.\n`;
 await commit(original,'generation');
 git('checkout','-qb','bot-proposal');
 await commit(original.replace('Produto v1.','Produto v2.'),'MCP product update');
 git('checkout','-q','-');
 await commit(original.replace('Texto original.','Texto humano concorrente.'),'human other section',true);
 git('branch','human-edits');
 if (botFirstParent) git('checkout','-q','bot-proposal');
 git('-c','user.name=Editor','-c','user.email=editor@example.test','merge','--no-ff','--no-commit',botFirstParent ? 'human-edits' : 'bot-proposal');
 if (humanResolution) {
   const pending = await readFile(join(root,path),'utf8');
   await writeFile(join(root,path),pending.replace('Resolução original.','Resolução humana no merge.'));
   git('add',path);
 }
 git('-c','user.name=Editor','-c','user.email=editor@example.test','commit','-qm','merge approved MCP PR');
 assert.equal(git('rev-list','--parents','-n','1','HEAD').split(' ').length,3,'merge real de dois pais');
 const merged=await readFile(join(root,path),'utf8');
 const humanBytes=merged.slice(merged.indexOf('## Humana'));
 const marker=merged.match(/^mcpGeneratedSha:.*$/m)[0];
 let current=merged;
 for (const version of [3,4]) {
   const result=await reconcileHumanUpdate(root,path,current.replace(`Produto v${version-1}.`,`Produto v${version}.`));
   assert.equal(result.status,'update','seção Produto sem edição humana continua atualizável após merge');
   assert.ok(result.content.includes(`Produto v${version}.`));
   assert.equal(result.content.slice(result.content.indexOf('## Humana')),humanBytes,'bytes humanos e resolução preservados');
   assert.equal(result.content.match(/^mcpGeneratedSha:.*$/m)[0],marker,'marcador conserva proveniência');
   await commit(result.content,`MCP product update ${version}`);
   current=result.content;
   for (const [before,after] of [
     ['Texto humano concorrente.','Proposta sobre a humana.'],
     ...(humanResolution ? [['Resolução humana no merge.','Proposta sobre resolução.']] : []),
   ]) {
     const conflict=await reconcileHumanUpdate(root,path,current.replace(before,after));
     assert.equal(conflict.status,'conflict','contribuição humana permanece protegida após merge e ciclo');
     assert.equal(conflict.content,null);
     assert.ok(conflict.notice.includes(before));
     assert.ok(conflict.notice.includes(after));
     assert.equal(await readFile(join(root,path),'utf8'),current);
   }
 }
 // Sem o blob de um dos pais, o merge não autoriza inferir proveniência.
 const blob=git('rev-parse','bot-proposal:example.mdx');
 await rm(join(root,'.git/objects',blob.slice(0,2),blob.slice(2)));
 const unavailable=await reconcileHumanUpdate(root,path,current.replace('Produto v4.','Produto v5.'));
 assert.equal(unavailable.status,'conflict');
 assert.match(unavailable.notice,/Histórico Git incompleto/);
 console.log(`PASS merge: resolução=${humanResolution}, bot no primeiro pai=${botFirstParent}; ciclos e histórico indisponível`);
} finally {await rm(root,{recursive:true,force:true});console.log('CLEANUP: OK (fixture própria)');}

}
}
