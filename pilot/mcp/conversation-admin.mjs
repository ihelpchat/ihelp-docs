const style = `<style>
  body{font:17px/1.5 system-ui,sans-serif;color:#15202b;background:#f5f7f8;max-width:1200px;margin:0 auto;padding:24px}
  h1,h2{line-height:1.2} form,.cards,table{background:white;border:1px solid #ccd5dc;border-radius:8px;padding:16px}
  form,.cards{display:flex;flex-wrap:wrap;gap:16px;margin:20px 0} label{display:grid;gap:4px} input,select,button{font:inherit;min-height:44px;padding:8px}
  button{cursor:pointer;background:#075a75;color:white;border:0;border-radius:5px} table{width:100%;border-collapse:collapse;text-align:left}
  td,th{border-bottom:1px solid #dce2e6;padding:10px;vertical-align:top} .scroll{overflow-x:auto} .question{max-width:500px;white-space:pre-wrap;overflow-wrap:anywhere}
  .cards div{min-width:145px} .cards strong{display:block;font-size:1.6em} #error{color:#a02020}
</style>`;

// A navegação comum não envia Authorization; o 401 oferece apenas o formulário de entrada.
export const adminLoginPage = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso interno</title>${style}
<h1>Conversas da Claricia</h1><p>Informe a credencial de administração.</p><form id="login"><label>Credencial<input id="token" type="password" autocomplete="off" required></label><button>Entrar</button></form><p id="error" role="alert"></p>
<script>async function enter(token){const response=await fetch(location.pathname,{headers:{Authorization:'Bearer '+token}});if(!response.ok){sessionStorage.removeItem('clariciaAdminToken');document.querySelector('#error').textContent='Credencial inválida.';return}sessionStorage.setItem('clariciaAdminToken',token);document.open();document.write(await response.text());document.close()};document.querySelector('#login').addEventListener('submit',e=>{e.preventDefault();enter(document.querySelector('#token').value)});if(sessionStorage.getItem('clariciaAdminToken'))enter(sessionStorage.getItem('clariciaAdminToken'));</script></html>`;

export const adminPage = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conversas da Claricia</title>${style}
<h1>Conversas da Claricia</h1><p>Veja as perguntas feitas e onde a ajuda precisa melhorar.</p>
<form id="filters"><label>De<input name="from" type="date"></label><label>Até<input name="to" type="date"></label>
<label>Origem<select name="origin"><option value="">Todas</option><option value="faq">Central de Ajuda</option><option value="app">App</option></select></label>
<label>Empresa<input name="companyId" type="number" min="1"></label>
<label>Resultado<select name="resolution"><option value="">Todos</option><option value="complete">Resolvido</option><option value="partial">Parcial</option><option value="not_found">Não achou</option><option value="escalated">Pessoa</option><option value="abandoned">Desistiu</option></select></label>
<button>Filtrar</button></form><p id="error" role="alert"></p><section class="cards" id="cards" aria-label="Resumo"></section>
<h2>Por assunto</h2><div class="scroll"><table><thead><tr><th>Assunto / ação</th><th>Perguntas</th><th>Resolvidas</th></tr></thead><tbody id="topics"></tbody></table></div>
<h2>Por empresa</h2><div class="scroll"><table><thead><tr><th>Empresa</th><th>Perguntas</th><th>Resolvidas</th></tr></thead><tbody id="companies"></tbody></table></div>
<h2>Perguntas sem solução</h2><div class="scroll"><table><thead><tr><th>Data</th><th>Origem</th><th>Empresa</th><th>Pergunta</th><th>Resposta</th></tr></thead><tbody id="questions"></tbody></table></div>
<p id="pagination"></p><button id="previous" type="button">Anterior</button> <button id="next" type="button">Próxima</button>
<script>
const token=sessionStorage.getItem('clariciaAdminToken');let page=1,totalPages=1;
const cell=(row,value,klass)=>{const td=document.createElement('td');td.textContent=value??'';if(klass)td.className=klass;row.append(td)};
const table=(selector,rows,values)=>{const body=document.querySelector(selector);body.replaceChildren();for(const item of rows){const tr=document.createElement('tr');for(const value of values)cell(tr,value(item),'question');body.append(tr)}};
async function load(){const params=new URLSearchParams(new FormData(document.querySelector('#filters')));params.set('page',String(page));
 const response=await fetch('/admin/claricia/data?'+params,{headers:{Authorization:'Bearer '+token}});
 if(!response.ok){document.querySelector('#error').textContent=response.status===401?'Credencial inválida. Reabra a página para entrar.':'Não foi possível carregar as conversas.';return}
 const data=await response.json();document.querySelector('#error').textContent='';
 const labels=[['total','Perguntas'],['complete','Resolvidas'],['partial','Parciais'],['not_found','Não achou'],['escalated','Passou para pessoa'],['abandoned','Desistiu']];
 const cards=document.querySelector('#cards');cards.replaceChildren();for(const [key,label] of labels){const div=document.createElement('div');const title=document.createElement('span');title.textContent=label;const value=document.createElement('strong');value.textContent=key==='total'?data.total:data.percentages[key]+'%';div.append(title,value);cards.append(div)}
 table('#topics',data.byTopic,[x=>x.topic,x=>x.total,x=>x.resolvedPercent+'%']);
 table('#companies',data.byCompany,[x=>x.companyId,x=>x.total,x=>x.resolvedPercent+'%']);
 table('#questions',data.unresolved,[x=>new Date(x.at).toLocaleString('pt-BR'),x=>x.origin,x=>x.companyId??'',x=>x.question,x=>x.answer]);
 totalPages=Math.max(1,Math.ceil(data.unresolvedTotal/data.pageSize));document.querySelector('#pagination').textContent='Página '+page+' de '+totalPages+' · '+data.unresolvedTotal+' perguntas sem solução';
 document.querySelector('#previous').disabled=page<=1;document.querySelector('#next').disabled=page>=totalPages;
}
document.querySelector('#filters').addEventListener('submit',e=>{e.preventDefault();page=1;load()});
document.querySelector('#previous').onclick=()=>{if(page>1){page--;load()}};
document.querySelector('#next').onclick=()=>{if(page<totalPages){page++;load()}};
load();</script></html>`;
