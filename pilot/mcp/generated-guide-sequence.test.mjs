import assert from 'node:assert/strict';
import { validateGuideSequence } from './generated-guide.mjs';
const guide = (steps) => ({initialStepId:'step-1',steps:steps.map((s,i)=>({...s,stepId:`step-${i+1}`,route:'/contact',next:i+1<steps.length?{nextStepId:`step-${i+2}`}:{outcome:'complete'}}))});
// Recorded real selections: all targets resolved, but these guides could not perform the procedure.
const shortcut=guide([
 {text:'Acesse as configurações:',locator:{kind:'heading',name:'Configurações'}},
 {text:'Vá para Atalhos.',locator:{kind:'link',name:'Atalhos'}},
 {text:'Crie um novo atalho:',locator:{kind:'button',name:'Criar atalho',within:'dialog'}},
]);
assert.throws(()=>validateGuideSequence(shortcut),error=>error.message==='unopened_dialog'&&error.stepId==='step-3');
const search=guide([{text:'Selecione o contato na lista para abrir o cadastro. Se não aparecer, use Limpar filtros.',locator:{kind:'button',name:'Limpar filtros'}}]);
assert.throws(()=>validateGuideSequence(search),error=>error.message==='alternative_target'&&error.stepId==='step-1');
assert.doesNotThrow(()=>validateGuideSequence(guide([
 {text:'Clique em Adicionar Contato.',locator:{kind:'button',name:'Adicionar Contato'}},
 {text:'Preencha Nome e Telefone.',locator:{kind:'field',name:'Nome',within:'dialog'}},
 {text:'Clique em Salvar.',locator:{kind:'button',name:'Salvar',within:'dialog'}},
])));
// Opening a dialog on one branch cannot authorize a different branch.
const branched=guide([{text:'Escolha.',locator:{kind:'heading',name:'Contatos'}},{text:'Abra.',locator:{kind:'button',name:'Adicionar Contato'}},{text:'Nome.',locator:{kind:'field',name:'Nome',within:'dialog'}}]);
branched.steps[0].next=undefined;branched.steps[0].choices=[{nextStepId:'step-2'},{nextStepId:'step-3'}];
assert.throws(()=>validateGuideSequence(branched),/unopened_dialog/);
console.log('Generated sequence: recorded bad targets rejected, explicit field anchor accepted');
