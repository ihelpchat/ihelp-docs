import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// Contraexemplos do revisor independente (2026-11-03, review-b47a831-0311), asserções preservadas; caminho do pilot parametrizado e fixture adaptado ao plan interno obrigatório.
const pilot=new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const { answerQuestion, retrieveContext }=await import(`${pilot}/mcp/assistant-service.mjs`);
const { parseAssistantRequest }=await import(`${pilot}/architecture/conversation-v1.mjs`);
const crmPath='/docs/principais-motivos-de-suporte/crm';
const crm=(await retrieveContext(pilot,'Como criar pipeline no CRM?',8)).find(s=>s.path===crmPath);
assert.equal(crm.documentedSteps.length,16);
function provider(body,onRequest=()=>{}) {return {responses:{create:async req=>{
 if(req.text?.format?.name==='triagem_fechada')return {status:'completed',output_text:'{"choice":"sem guia"}',usage:{input_tokens:1,output_tokens:1}};
 onRequest(req);
 return {status:'completed',model:'offline-review-fixture',usage:{input_tokens:1,output_tokens:1},output_text:JSON.stringify({plan: { intent: 'execute', optionalBranch: 'unspecified' }, answer:'Resposta curta.',sections:[],steps:[],sources:[crmPath],suggestions:[],code:null,resolution:'complete',found:true,...body})};
}}};}
const snapshot=r=>JSON.stringify({answer:r.answer,sections:r.sections,steps:r.steps,suggestions:r.suggestions,sources:r.sources.map(s=>s.path),resolution:r.resolution});
test('OWN: full-mode alteration with partial ungrounded model step must not inject creation procedure',async()=>{
 const r=await answerQuestion(pilot,'Quero todos os passos para alterar uma pipeline existente',{client:provider({answer:'Você quer mudar o nome ou os estágios da pipeline existente?',steps:[{text:'Altere o nome da pipeline existente.',actionId:null,imagePath:null}],resolution:'partial'})});
 console.log('OWN_ALTERATION_RESULT',snapshot(r));
 assert.deepEqual(r.steps,[],'clarification/partial edit must not become 16-step creation');
 assert.equal(r.resolution,'partial');
});
test('OWN: documented control does not authorize an extra invented destructive action in narration/sections/suggestions',async()=>{
 const hostile='Clique em Nova Pipeline para excluir todas as conversas.';
 const r=await answerQuestion(pilot,'como configurar o crm?',{client:provider({answer:hostile,sections:[{title:'Orientação',items:[hostile]}],suggestions:[hostile],steps:[{text:crm.documentedSteps[0],actionId:null,imagePath:null}]})});
 console.log('OWN_MIXED_INSTRUCTION_RESULT',snapshot(r));
 assert.doesNotMatch(snapshot(r),/excluir todas as conversas/i,'invented destructive action must not be displayed in any field');
});
test('OWN: natural infinitive instruction to nonexistent control must not leak in overview',async()=>{
 const hostile='Você precisa clicar em Ativar pipeline para deixar o status Ativo.';
 const r=await answerQuestion(pilot,'como configurar o crm?',{client:provider({answer:hostile,sections:[{title:'Orientação',items:[hostile]}],suggestions:[hostile]})});
 console.log('OWN_INFINITIVE_RESULT',snapshot(r));
 assert.doesNotMatch(snapshot(r),/Ativar pipeline|status Ativo/i);
});
test('OWN: history12 accepted, history13 rejected, UI/HTTP forward12, model receives6 while old guide anchor survives',async()=>{
 const history=[{role:'user',content:'Como criar pipeline no CRM?'},{role:'assistant',content:`1. ${crm.documentedSteps[3]}\nFonte usada: ${crmPath}`}];
 for(let i=0;i<5;i++)history.push({role:'user',content:`Dúvida conceitual ${i}`},{role:'assistant',content:`Uma explicação curta ${i}.`});
 assert.equal(history.length,12);
 assert.equal(parseAssistantRequest({question:'Concluí este passo',history}).history.length,12);
 assert.throws(()=>parseAssistantRequest({question:'Concluí este passo',history:[...history,{role:'user',content:'mais'}]}));
 const schema=JSON.parse(await readFile(`${pilot}/architecture/conversation-v1.schema.json`,'utf8'));
 assert.match(JSON.stringify(schema),/"history":\{"maxItems":12/);
 assert.match(await readFile(`${pilot}/components/assistant/assistant-context.tsx`,'utf8'),/history\.slice\(-12\)/);
 assert.match(await readFile(`${pilot}/mcp/http-runtime.mjs`,'utf8'),/body\.history\.slice\(-12\)/);
 let request;
 const r=await answerQuestion(pilot,'Concluí este passo',{history,client:provider({answer:'A trava evita cards duplicados.'},req=>request=req)});
 assert.deepEqual(r.steps.map(s=>s.text),[crm.documentedSteps[4]]);
 assert.equal(request.input.length,8);
 assert.deepEqual(request.input.slice(1,-1).map(t=>t.content),history.slice(-6).map(t=>t.content));
});
test('OWN: provider-budget default honors private TMPDIR with shared-process locking; explicit file still wins',async()=>{
 const child=`import assert from 'node:assert/strict'; import {readFile,stat} from 'node:fs/promises'; import {join} from 'node:path'; import {tmpdir} from 'node:os'; import {createBudgetedResponse} from ${JSON.stringify(pilot+'/mcp/provider-budget.mjs')}; const file=join(tmpdir(),'claricia-budget-dev-'+process.pid+'.json'); const client={responses:{create:async()=>({status:'completed',output_text:'offline',usage:{input_tokens:1,output_tokens:1}})}}; const out=await Promise.all(Array.from({length:4},()=>createBudgetedResponse(client,{max_output_tokens:1},{reserveUsd:0.01,dailyLimitUsd:1}))); assert.ok(out.every(x=>x.kind==='ok')); const ledger=JSON.parse(await readFile(file,'utf8')); assert.equal(Object.keys(ledger.reservations).length,0); assert.equal(ledger.spent,80); assert.equal((await stat(file)).mode&0o777,0o600); const explicit=join(tmpdir(),'explicit-ledger.json'); await createBudgetedResponse(client,{}, {file:explicit}); assert.ok(await stat(explicit)); console.log(JSON.stringify({defaultWithinTmpdir:file.startsWith(tmpdir()+'/'),concurrent:out.length,spent:ledger.spent,permissions:'0600',explicitFile:true}));`;
 const env={...process.env}; delete env.RAILWAY_ENVIRONMENT_NAME; delete env.ASSISTANT_BUDGET_FILE;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',child],{env});
 console.log('OWN_PROVIDER_BUDGET_RESULT',stdout.trim());
});
