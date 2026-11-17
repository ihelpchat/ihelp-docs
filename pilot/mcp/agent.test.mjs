import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeChunk } from './kb-chunk.mjs';
import { createSearch } from './kb-search.mjs';
import { createBudgetedResponse } from './provider-budget.mjs';

const state = await mkdtemp(join(tmpdir(), 'agent-test-'));
process.env.MCP_STATE_DIR = state;
const { faqPedir, faqResponder, faqStatus, idle } = await import('./agent-service.mjs');
const { loadSession, saveSession } = await import('./agent-session.mjs');

const root = state;
const actor = 'user:bruno';
const pages = {
  'docs/sobre-o-sistema/campanhas': { title: 'Campanhas', description: 'Disparo em massa.', body: '## Como criar\n\nAbra Campanhas.' },
  'docs/contatos/exportar': { title: 'Exportar contatos do celular', description: '', body: 'Baixe a agenda.' },
};
const index = { version: 't', chunks: [
  makeChunk({ source: 'faq', title: 'Campanhas', text: 'Dispare mensagens em massa para uma lista.', ref: { path: 'docs/sobre-o-sistema/campanhas' } }),
  makeChunk({ source: 'faq', title: 'Exportar contatos do celular', text: 'Baixe a agenda do aparelho.', ref: { path: 'docs/contatos/exportar' } }),
  makeChunk({ source: 'negocio', title: 'Risco de bloqueio', text: 'Canal por QR é mais suscetível a bloqueio em campanha.', ref: { path: 'business-context/campanhas.md' } }),
] };

// Modelo simulado: cada passo é uma função que recebe o payload e devolve as chamadas de ferramenta.
const call = (name, args) => ({ type: 'function_call', call_id: `c${Math.random()}`, name, arguments: JSON.stringify(args) });
function scripted(steps) {
  const seen = [];
  return { seen, responses: { create: async (payload) => {
    seen.push(structuredClone(payload.input));
    const step = steps[Math.min(seen.length - 1, steps.length - 1)];
    return { status: 'completed', output: step(payload), usage: { input_tokens: 1_000, output_tokens: 100 } };
  } } };
}
const deps = (client, extra = {}) => ({ client, search: createSearch(index),
  readArticle: async (path) => { if (!pages[path]) throw new Error('artigo não encontrado'); return pages[path]; },
  pageExists: async (path) => Boolean(pages[path]),
  searchCode: async () => ({ matches: [{ repository: 'front', path: 'src/Campaign.tsx', line: 3, excerpt: 'SEGREDO_INTERNO do código' }] }), ...extra });
const lastOutputs = (input) => input.filter((item) => item.type === 'function_call_output').map(({ output }) => JSON.parse(output));
const plano = (extra = {}) => ({ acao: 'novo_topico', destino: { path: 'docs/sobre-o-sistema/campanhas', anchor: null }, relacionados: [],
  alternativas: [],
  secoes: [{ titulo: 'Canal por QR Code e risco de bloqueio', tipo: 'conceito', evidencias: ['docs/sobre-o-sistema/campanhas'] }], telasAObservar: [], confirmar: true, perguntas: null,
  motivo: 'Já existe a página de Campanhas; o pedido cabe como seção nova nela.', ...extra });

// --- 1. ordem fixa: plano antes de buscar é recusado; depois busca, lê, propõe e pede confirmação ---
const first = scripted([
  () => [call('propor_plano', plano())],
  () => [call('buscar', { query: 'campanha bloqueio QR', sources: null, module: null }), call('ler_codigo', { topic: 'campanha', module: null })],
  () => [call('ler_pagina', { path: '/docs/sobre-o-sistema/campanhas' })],
  () => [call('propor_plano', plano())],
]);
const opened = await faqPedir(root, { pedido: 'Preciso de um FAQ sobre campanha, com um tópico sobre QR ser mais suscetível a bloqueio', requestedBy: actor }, deps(first));
assert.equal(opened.estado, 'trabalhando', 'responde na hora');
await idle(opened.sessao);
let status = await faqStatus(root, { sessao: opened.sessao, requestedBy: actor });
assert.match(JSON.stringify(lastOutputs(first.seen[1])), /busque na base antes/, 'plano sem busca é recusado em código');
assert.ok(lastOutputs(first.seen[2]).find(({ hits }) => hits).hits.some(({ path }) => path === 'docs/sobre-o-sistema/campanhas'));
assert.equal(status.estado, 'aguardando_usuario');
assert.equal(status.plano.acao, 'novo_topico');
assert.equal(status.perguntas.length, 1, 'confirmar: true vira pergunta de decisão');
assert.equal(status.passos, 4);
assert.ok(status.custoUsd > 0);
assert.ok(!JSON.stringify(status).includes('SEGREDO_INTERNO'), 'trecho de código nunca volta para quem chamou');
assert.ok(!JSON.stringify(status).includes('business-context'), 'caminho de fonte interna não aparece');

// --- 2. resposta do usuário volta ao agente e fecha o plano ---
const second = scripted([
  () => [call('propor_plano', plano({ confirmar: false }))],
]);
await assert.rejects(() => faqResponder(root, { sessao: opened.sessao, respostas: [{ perguntaId: 'ffffffffffff', texto: 'sim' }], requestedBy: actor }, deps(second)), /não está aberta/);
await assert.rejects(() => faqResponder(root, { sessao: opened.sessao, sugestao: 'x', requestedBy: 'user:outra' }, deps(second)), /outro ator/);
await faqResponder(root, { sessao: opened.sessao, respostas: [{ perguntaId: status.perguntas[0].id, texto: 'Sim, seguir' }],
  sugestao: 'Inclua um exemplo de loja de roupas', requestedBy: actor }, deps(second));
await idle(opened.sessao);
status = await faqStatus(root, { sessao: opened.sessao, requestedBy: actor });
const prompt = second.seen[0][0].content;
assert.match(prompt, /Resposta de quem pediu: Sim, seguir/);
assert.match(prompt, /loja de roupas/);
assert.match(prompt, /Já encontrado em turnos anteriores/);
assert.equal(status.estado, 'plano_pronto');
assert.equal(status.perguntas.length, 0);

// --- 3. plano com caminho inventado ou página que já existe é recusado, e o agente pode perguntar ---
const third = scripted([
  () => [call('buscar', { query: 'importar contatos', sources: ['faq'], module: null })],
  () => [call('propor_plano', plano({ acao: 'novo_faq', destino: { path: 'docs/contatos/exportar', anchor: null } }))],
  () => [call('propor_plano', plano({ relacionados: [{ path: 'docs/nao/existe', motivo: 'x' }] }))],
  () => [call('perguntar', { perguntas: [{ texto: 'A importação é por planilha ou pelo celular?', tipo: 'fato', opcoes: ['Planilha', 'Celular'], obrigatoria: true }] })],
]);
const importar = await faqPedir(root, { pedido: 'Quero um FAQ ensinando a importar contatos', requestedBy: actor }, deps(third));
await idle(importar.sessao);
assert.match(JSON.stringify(lastOutputs(third.seen[2])), /já existe página em docs\/contatos\/exportar/);
assert.match(JSON.stringify(lastOutputs(third.seen[3])), /relacionado não existe/);
status = await faqStatus(root, { sessao: importar.sessao, requestedBy: actor });
assert.equal(status.estado, 'aguardando_usuario');
assert.equal(status.plano, null, 'plano recusado não fica gravado');
assert.deepEqual(status.perguntas[0].opcoes.map(({ rotulo }) => rotulo), ['Planilha', 'Celular']);

// --- 3b. evidência inventada é recusada; mais de um destino possível vira escolha de quem pediu ---
const fourth = scripted([
  () => [call('buscar', { query: 'campanha', sources: ['faq'], module: null })],
  (payload) => [call('propor_plano', plano({ confirmar: false, secoes: [{ titulo: 'Risco de bloqueio', tipo: 'conceito', evidencias: ['f'.repeat(24)] }] }))],
  (payload) => { const id = payload.input.flatMap((item) => item.type === 'function_call_output' ? JSON.parse(item.output).hits ?? [] : [])[0].id;
    return [call('propor_plano', plano({ confirmar: false, alternativas: [{ path: 'docs/contatos/exportar', motivo: 'também fala de listas' }],
      secoes: [{ titulo: 'Risco de bloqueio', tipo: 'conceito', evidencias: [id] }] }))]; },
]);
const escolha = await faqPedir(root, { pedido: 'Quero explicar o risco de bloqueio em campanhas', requestedBy: actor }, deps(fourth));
await idle(escolha.sessao);
assert.match(JSON.stringify(lastOutputs(fourth.seen[2])), /evidência desconhecida/);
status = await faqStatus(root, { sessao: escolha.sessao, requestedBy: actor });
assert.equal(status.estado, 'aguardando_usuario');
assert.deepEqual(status.perguntas[0].opcoes.map(({ rotulo }) => rotulo), ['docs/sobre-o-sistema/campanhas', 'docs/contatos/exportar']);
assert.equal(status.plano.secoes[0].evidencias.length, 1);

// --- 4. tetos: passos e custo da sessão ---
const looping = scripted([() => [call('buscar', { query: 'campanha', sources: null, module: null })]]);
const capped = await faqPedir(root, { pedido: 'Explique campanhas de ponta a ponta', requestedBy: actor }, deps(looping, { maxSteps: 3 }));
await idle(capped.sessao);
status = await faqStatus(root, { sessao: capped.sessao, requestedBy: actor });
assert.equal(status.estado, 'aguardando_usuario');
assert.match(status.motivo, /limite de 3 passos/);
assert.equal(looping.seen.length, 3);

const pricey = await faqPedir(root, { pedido: 'Explique campanhas de ponta a ponta', requestedBy: actor }, deps(scripted([() => [call('buscar', { query: 'campanha', sources: null, module: null })]]), { sessionBudgetUsd: 0.02 }));
await idle(pricey.sessao);
assert.match((await faqStatus(root, { sessao: pricey.sessao, requestedBy: actor })).motivo, /limite de custo/);

// --- 5. modelo que só fala, sem chamar ferramenta, não fica em laço ---
const mute = scripted([() => [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }]]);
const silent = await faqPedir(root, { pedido: 'Explique campanhas de ponta a ponta', requestedBy: actor }, deps(mute));
await idle(silent.sessao);
assert.equal(mute.seen.length, 2);
assert.match((await faqStatus(root, { sessao: silent.sessao, requestedBy: actor })).motivo, /Não consegui fechar um plano/);

// --- 6. pedido com credencial é barrado; provedor fora vira "falhou" com retomada ---
await assert.rejects(() => faqPedir(root, { pedido: 'Use a chave sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 no FAQ', requestedBy: actor }, deps(mute)), /dado sensível/);
const down = { responses: { create: async () => { throw new Error('Resposta da IA indisponível'); } } };
const failed = await faqPedir(root, { pedido: 'Explique campanhas de ponta a ponta', requestedBy: actor }, deps(down));
await idle(failed.sessao);
assert.equal((await faqStatus(root, { sessao: failed.sessao, requestedBy: actor })).estado, 'falhou');
await faqResponder(root, { sessao: failed.sessao, requestedBy: actor }, deps(second));
await idle(failed.sessao);
assert.equal((await faqStatus(root, { sessao: failed.sessao, requestedBy: actor })).estado, 'aguardando_usuario', 'retomou e bateu na regra de buscar antes');

// --- 7. serviço reiniciou no meio do turno ---
const stuck = await loadSession(root, failed.sessao);
await saveSession(root, { ...stuck, estado: 'trabalhando' });
assert.match((await faqStatus(root, { sessao: failed.sessao, requestedBy: actor })).motivo, /reiniciou/);
await assert.rejects(() => faqStatus(root, { sessao: 'a'.repeat(32), requestedBy: actor }), /não encontrada/);
await assert.rejects(() => faqStatus(root, { sessao: failed.sessao, requestedBy: actor, }, { now: Date.now() + 73 * 3_600_000 }), /expirada/);

// --- 8. orçamento: resposta só com chamada de ferramenta é válida e cobrada uma vez ---
let charged = 0;
const tooled = { responses: { create: async () => { charged++; return { status: 'completed', output_text: '', output: [call('buscar', {})], usage: { input_tokens: 10, output_tokens: 10 } }; } } };
const ledger = { file: join(state, 'budget.json'), dailyLimitUsd: 5 };
assert.equal((await createBudgetedResponse(tooled, { input: 'x' }, { ...ledger, acceptToolCalls: true })).kind, 'ok');
assert.equal(charged, 1);
assert.equal((await createBudgetedResponse(tooled, { input: 'x' }, ledger)).kind, 'provider_failed', 'sem a opção, o comportamento antigo não muda');

// --- 9. escrever: o texto só vira rascunho depois dos juízes; quem pediu vê o texto e o resultado ---
const { faqRascunho } = await import('./agent-service.mjs');
const { mergeIntoPage } = await import('./agent-gates.mjs');
const { APPLICABILITY, EDITORIAL_CRITERIA } = await import('./faq-editorial-judge.mjs');
const raw = { 'docs/sobre-o-sistema/campanhas': '---\ntitle: Campanhas\n---\n\nDisparo em massa.\n\n## Como criar\n\nAbra Campanhas.\n' };
const negocio = index.chunks[2].id;
// Juízes simulados: "facts" decide cada frase; "nota" é a nota editorial de todos os critérios aplicáveis.
function writer(steps, { facts, nota = 4 }) {
  const seen = [], judged = [];
  let turn = 0;
  const usage = { input_tokens: 1_000, output_tokens: 100 };
  return { seen, judged, responses: { create: async (payload) => {
    const format = payload.text?.format;
    if (format?.name === 'faq_agent_facts') {
      const body = JSON.parse(payload.input[0].content);
      judged.push(body);
      return { status: 'completed', output: [], usage, output_text: JSON.stringify({ claims: body.claims.map((claim) => ({ id: claim.id, sourceMention: false, evidenceIds: claim.evidenceIds, ...facts(claim) })) }) };
    }
    if (format?.name === 'faq_agent_editorial') {
      const proposito = format.schema.properties.proposito.enum[0];
      return { status: 'completed', output: [], usage, output_text: JSON.stringify({ proposito, defeitosGraves: [], naoVerificaveis: [], comentario: 'Falta dizer quando usar.',
        notas: Object.fromEntries(EDITORIAL_CRITERIA.map((id) => [id, APPLICABILITY[proposito].includes(id) ? (typeof nota === 'function' ? nota() : nota) : null])) }) };
    }
    seen.push(structuredClone(payload.input));
    return { status: 'completed', output: steps[Math.min(turn++, steps.length - 1)](payload), usage };
  } } };
}
const writeDeps = (client) => deps(client, { readRaw: async (path) => raw[path], chunkById: async (id) => index.chunks.find((chunk) => chunk.id === id) ?? null });
const texto = (unidades) => ({ title: 'Campanhas', description: 'Disparo em massa.', secoes: [{ titulo: 'Canal por QR Code e risco de bloqueio', unidades }] });
const frase = { texto: 'O canal conectado por QR Code é mais suscetível a bloqueio em campanhas.', tipo: 'contexto', evidencias: [negocio] };
const semProva = { texto: 'O iHelp pausa a campanha sozinho quando o canal cai.', tipo: 'contexto', evidencias: [] };
const planning = [
  () => [call('buscar', { query: 'campanha bloqueio QR', sources: null, module: null })],
  () => [call('ler_pagina', { path: 'docs/sobre-o-sistema/campanhas' })],
  () => [call('escrever', texto([frase]))],
  () => [call('propor_plano', plano({ confirmar: false, secoes: [{ titulo: 'Canal por QR Code e risco de bloqueio', tipo: 'conceito', evidencias: [negocio] }] }))],
];
const ok = writer([...planning,
  () => [call('propor_plano', plano())],
  () => [call('escrever', texto([{ ...frase, evidencias: ['f'.repeat(24)] }]))],
  () => [call('escrever', texto([frase, semProva]))],
], { facts: ({ text: phrase }) => /pausa/.test(phrase) ? { status: 'a confirmar', reason: 'sem evidência' } : { status: 'sustentada', reason: 'a evidência diz isso' } });
const draft = await faqPedir(root, { pedido: 'Quero um tópico sobre QR ser mais suscetível a bloqueio em campanha', requestedBy: actor }, writeDeps(ok));
await idle(draft.sessao);
status = await faqStatus(root, { sessao: draft.sessao, requestedBy: actor });
assert.equal(status.estado, 'plano_pronto');
assert.match(JSON.stringify(lastOutputs(ok.seen[3])), /não vale nesta etapa/, 'escrever antes do plano fechado é recusado em código');
assert.match(status.proximo, /faq_rascunho/);
assert.equal((await faqRascunho(root, { sessao: draft.sessao, requestedBy: actor }, writeDeps(ok))).estado, 'trabalhando', 'responde na hora');
await idle(draft.sessao);
let view = await faqRascunho(root, { sessao: draft.sessao, requestedBy: actor }, writeDeps(ok));
assert.match(JSON.stringify(lastOutputs(ok.seen[5])), /não vale nesta etapa/, 'replanejar durante a escrita é recusado');
assert.match(JSON.stringify(lastOutputs(ok.seen[6])), /evidência desconhecida/, 'evidência inventada não chega aos juízes');
assert.equal(ok.judged.length, 1, 'problema de forma não gasta juiz');
assert.ok(ok.judged[0].evidence.some(({ id, type }) => id === negocio && type === 'negocio'), 'o juiz recebe a evidência citada');
assert.equal(view.estado, 'rascunho_pronto');
assert.equal(view.gates.aprovado, true);
assert.deepEqual(view.gates.fatos, { sustentadas: 1, aConfirmar: [semProva.texto], contradicoes: [] });
assert.match(view.mdx, /^---\ntitle: Campanhas\n---\n\nDisparo em massa\.\n\n## Como criar\n\nAbra Campanhas\.\n\n## Canal por QR Code e risco de bloqueio\n\n/, 'a página existente fica intacta');
assert.ok(view.mdx.includes(`${frase.texto}\n\n<AConfirmar>${semProva.texto}</AConfirmar>`), 'frase sem prova sai marcada');
assert.deepEqual(view.pendencias, [semProva.texto]);
assert.match(view.revisao, /^[a-f0-9]{64}$/);
assert.equal(view.previewUrl, null);
assert.doesNotMatch(JSON.stringify(view), /business-context|a evidência diz isso|motivos/, 'motivo de juiz e fonte interna não saem pelo MCP');
assert.equal((await faqStatus(root, { sessao: draft.sessao, requestedBy: actor })).rascunho.aprovado, true);

// --- 10. contradição: uma correção; persistindo, reprovado. Sugestão de quem pediu abre nova tentativa ---
let contradiz = true;
const bad = writer([...planning.slice(0, 2), planning[3], () => [call('escrever', texto([frase]))]],
  { facts: () => contradiz ? { status: 'contradiz a fonte', reason: 'a evidência diz o contrário' } : { status: 'sustentada', reason: 'ok' } });
const rejected = await faqPedir(root, { pedido: 'Quero um tópico sobre QR e bloqueio em campanha', requestedBy: actor }, writeDeps(bad));
await idle(rejected.sessao);
await assert.rejects(() => faqRascunho(root, { sessao: 'b'.repeat(32), requestedBy: actor }), /não encontrada/);
await faqRascunho(root, { sessao: rejected.sessao, requestedBy: actor }, writeDeps(bad));
await idle(rejected.sessao);
view = await faqRascunho(root, { sessao: rejected.sessao, requestedBy: actor }, writeDeps(bad));
assert.equal(view.estado, 'reprovado');
assert.equal(bad.judged.length, 2, 'uma única correção');
assert.match(JSON.stringify(lastOutputs(bad.seen.at(-1))), /a evidência diz o contrário/, 'o agente recebe o motivo para corrigir');
assert.deepEqual(view.gates.fatos.contradicoes, [frase.texto]);
assert.equal(view.gates.aprovado, false);
contradiz = false;
await faqResponder(root, { sessao: rejected.sessao, sugestao: 'Diga só que o risco é maior, sem números.', requestedBy: actor }, writeDeps(bad));
await idle(rejected.sessao);
assert.equal((await faqRascunho(root, { sessao: rejected.sessao, requestedBy: actor }, writeDeps(bad))).estado, 'rascunho_pronto');

// --- 11. nota editorial baixa reprova; plano "aguardando" não tem rascunho; seção de mesmo título é substituída ---
const weak = writer([...planning.slice(0, 2), planning[3], () => [call('escrever', texto([frase]))]], { facts: () => ({ status: 'sustentada', reason: 'ok' }), nota: 2 });
const poor = await faqPedir(root, { pedido: 'Quero um tópico curto sobre QR e bloqueio', requestedBy: actor }, writeDeps(weak));
await idle(poor.sessao);
await faqRascunho(root, { sessao: poor.sessao, requestedBy: actor }, writeDeps(weak));
await idle(poor.sessao);
view = await faqRascunho(root, { sessao: poor.sessao, requestedBy: actor }, writeDeps(weak));
assert.equal(view.estado, 'reprovado');
assert.equal(view.gates.editorial.aceite, false);
const waiting = await faqPedir(root, { pedido: 'Quero um tópico sobre QR e bloqueio, se couber', requestedBy: actor }, writeDeps(writer([...planning.slice(0, 2), () => [call('propor_plano', plano())]], { facts: () => ({}) })));
await idle(waiting.sessao);
await assert.rejects(() => faqRascunho(root, { sessao: waiting.sessao, requestedBy: actor }), /ainda não tem rascunho/);
assert.equal(mergeIntoPage('---\ntitle: T\n---\n\nIntro.\n\n## Como criar\n\nVelho.\n\n## Outra\n\nFica.\n',
  [{ heading: 'como criar', taskId: null, units: [{ text: 'Novo.', kind: 'contexto' }] }]),
'---\ntitle: T\n---\n\nIntro.\n\n## como criar\n\nNovo.\n\n## Outra\n\nFica.\n');

// --- 12. prévia: só rascunho aprovado, só a pedido; previewUrl só depois que o staging serve o commit ---
const calls = [];
let live = null;
const preview = { env: { AGENT_PREVIEW_SITE_URL: 'https://staging.example.test/ihelp-docs/', GITHUB_BASE_BRANCH: 'main' },
  github: async (path, init = {}) => {
    calls.push(`${init.method ?? 'GET'} ${path.replace('/repos/ihelpchat/ihelp-docs', '')}`);
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: 'b'.repeat(40) } };
    if (init.method === 'PUT') { assert.equal(Buffer.from(JSON.parse(init.body).content, 'base64').toString('utf8'), approved.mdx); return { commit: { sha: 'c'.repeat(40) } }; }
    return null;
  },
  fetcher: async () => ({ ok: true, json: async () => ({ codeSha: live }) }) };
const approved = await faqRascunho(root, { sessao: draft.sessao, requestedBy: actor }, writeDeps(ok));
assert.match(approved.previa, /previa: true/, 'sem pedir, nada vai para o GitHub');
await assert.rejects(() => faqRascunho(root, { sessao: poor.sessao, previa: true, requestedBy: actor }, { preview }), /só rascunho aprovado/);
assert.equal(calls.length, 0);
view = await faqRascunho(root, { sessao: draft.sessao, previa: true, requestedBy: actor }, { preview });
const branch = `rascunho/${draft.sessao.slice(0, 12)}`;
assert.deepEqual(calls, ['GET /git/ref/heads/main', `GET /git/ref/heads/${branch}`, 'POST /git/refs',
  `GET /contents/pilot/content/docs/docs/sobre-o-sistema/campanhas.mdx?ref=${encodeURIComponent(branch)}`,
  'PUT /contents/pilot/content/docs/docs/sobre-o-sistema/campanhas.mdx', 'POST /actions/workflows/deploy.yml/dispatches']);
assert.equal(view.previewUrl, null, 'site ainda não serve o commit');
assert.match(view.previa, /sendo publicado/);
view = await faqRascunho(root, { sessao: draft.sessao, previa: true, requestedBy: actor }, { preview });
assert.equal(calls.length, 6, 'pedir de novo não republica');
live = 'c'.repeat(40);
view = await faqRascunho(root, { sessao: draft.sessao, requestedBy: actor }, { preview });
assert.equal(view.previewUrl, 'https://staging.example.test/ihelp-docs/docs/sobre-o-sistema/campanhas');
live = 'd'.repeat(40);
view = await faqRascunho(root, { sessao: draft.sessao, requestedBy: actor }, { preview });
assert.equal(view.previewUrl, null);
assert.match(view.previa, /por cima/);
await assert.rejects(() => faqRascunho(root, { sessao: rejected.sessao, previa: true, requestedBy: actor }, { preview: { ...preview, env: {} } }), /não configurado/);

await rm(state, { recursive: true, force: true });
console.log('agente editor: ordem fixa, plano validado, perguntas e respostas, tetos, retomada, orçamento, escrita com juízes e prévia.');
