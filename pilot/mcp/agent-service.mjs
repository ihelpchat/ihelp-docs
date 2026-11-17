import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSession, draftView, loadSession, logStep, saveSession, summarize } from './agent-session.mjs';
import { runTurn } from './agent-loop.mjs';
import { containsSensitiveData } from './sensitive-data.mjs';

// Liga as tools faq_pedir / faq_responder / faq_status / faq_rascunho ao agente.
// O turno roda em segundo plano; quem chamou acompanha por faq_status.

const running = new Map();
const PREVIEW_RETRY_MS = () => Number(process.env.AGENT_PREVIEW_RETRY_MS ?? 15 * 60_000);

async function defaults(root, options) {
  const { readArticle } = await import('./editorial-standard.mjs');
  const read = (path) => readArticle(root, path);
  let client = options.client;
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');
    client = new (await import('openai')).default();
  }
  let shared;
  const base = () => shared ??= import('./kb-store.mjs').then(({ sharedKnowledgeBase }) => sharedKnowledgeBase(root));
  return {
    client, budget: options.client ? options.budget : (options.budget ?? {}), model: options.model, judgeModel: options.judgeModel,
    search: options.search ?? (await base()).search,
    chunkById: options.chunkById ?? (async (id) => (await base()).index.chunks.find((chunk) => chunk.id === id) ?? null),
    readArticle: options.readArticle ?? read,
    // Texto bruto da página de destino, para encaixar o tópico. readArticle valida o caminho antes.
    readRaw: options.readRaw ?? (async (path) => { await read(path); return readFile(join(root, 'content/docs', `${path}.mdx`), 'utf8'); }),
    pageExists: options.pageExists ?? ((path) => read(path).then(() => true, () => false)),
    searchCode: options.searchCode ?? (async (topic, module) =>
      (await import('./local-product-context.mjs')).searchLocalProductContext(topic, module)),
    save: (session) => saveSession(root, session),
    maxSteps: options.maxSteps, sessionBudgetUsd: options.sessionBudgetUsd,
  };
}

function start(root, session, options) {
  const work = (async () => {
    try { await runTurn(session, await defaults(root, options)); }
    catch (error) {
      session.estado = 'falhou';
      session.motivo = error instanceof Error ? error.message.slice(0, 200) : 'falha no agente';
      logStep(session, 'falha', session.motivo);
      await saveSession(root, session).catch(() => {});
    } finally { running.delete(session.id); }
  })();
  running.set(session.id, work);
  return work;
}

const checkText = (value, label) => {
  if (containsSensitiveData(value)) throw new Error(`${label} contém dado sensível (credencial ou dado pessoal); remova e reenvie`);
};

export async function faqPedir(root, { pedido, modulo, requestedBy }, options = {}) {
  checkText(`${pedido}\n${modulo ?? ''}`, 'O pedido');
  const session = await createSession(root, { pedido: pedido.trim(), modulo: modulo?.trim() || null, criadaPor: requestedBy }, options);
  start(root, session, options);
  return summarize(session);
}

export async function faqResponder(root, { sessao, respostas = [], sugestao, requestedBy }, options = {}) {
  const session = await loadSession(root, sessao, { actor: requestedBy, now: options.now });
  if (running.has(session.id)) throw new Error('o agente ainda está trabalhando nesta sessão; acompanhe por faq_status');
  // "trabalhando" sem turno vivo = serviço reiniciou; responder retoma.
  const retomada = session.estado === 'falhou' || session.estado === 'trabalhando';
  if (!retomada && !['aguardando_usuario', 'plano_pronto', 'rascunho_pronto', 'reprovado'].includes(session.estado)) throw new Error(`sessão em "${session.estado}" não aceita resposta`);
  if (!respostas.length && !sugestao?.trim() && !retomada) throw new Error('envie ao menos uma resposta ou uma sugestão');
  const open = new Set(session.perguntas.filter(({ id }) => !session.respostas.some(({ perguntaId }) => perguntaId === id)).map(({ id }) => id));
  const em = new Date(options.now ?? Date.now()).toISOString();
  for (const { perguntaId, texto } of respostas) {
    if (!open.has(perguntaId)) throw new Error(`pergunta ${perguntaId} não está aberta nesta sessão`);
    checkText(texto, 'A resposta');
    session.respostas.push({ perguntaId, texto: texto.trim(), em });
    open.delete(perguntaId);
  }
  if (sugestao?.trim()) { checkText(sugestao, 'A sugestão'); session.sugestoes.push({ texto: sugestao.trim(), em }); }
  logStep(session, 'usuario', `${respostas.length} resposta(s)${sugestao?.trim() ? ' e uma sugestão' : ''}`);
  // Sugestão depois do plano fechado volta ao planejamento; depois de um rascunho, é ajuste de texto.
  if (session.estado === 'plano_pronto') session.modo = 'plano';
  if (['rascunho_pronto', 'reprovado'].includes(session.estado)) session.tentativasEscrita = 0;
  session.estado = 'trabalhando';
  await saveSession(root, session);
  start(root, session, options);
  return summarize(session);
}

/** Escreve o texto do plano fechado (em segundo plano) ou devolve o rascunho já julgado. */
export async function faqRascunho(root, { sessao, previa = false, requestedBy }, options = {}) {
  const session = await loadSession(root, sessao, { actor: requestedBy, now: options.now });
  if (running.has(session.id)) return summarize(session);
  if (session.estado === 'plano_pronto') {
    if (!session.plano || session.plano.acao === 'nada') throw new Error('o plano concluiu que o conteúdo já existe; não há o que escrever');
    session.modo = 'escrever';
    session.tentativasEscrita = 0;
    session.estado = 'trabalhando';
    logStep(session, 'usuario', 'pediu o rascunho');
    await saveSession(root, session);
    start(root, session, options);
    return summarize(session);
  }
  if (session.rascunho && ['rascunho_pronto', 'reprovado'].includes(session.estado)) {
    const { startPreview, checkPreview } = await import('./agent-preview.mjs');
    const atual = session.previa?.revisao === session.rascunho.revisao ? session.previa : null;
    const agora = options.now ?? Date.now();
    // Deploy que não chegou ao ar no prazo (falhou ou foi cancelado): pedir a prévia de novo republica.
    const travada = atual?.estado === 'publicando' && agora - Date.parse(atual.iniciadaEm) > PREVIEW_RETRY_MS();
    if (previa && (!atual || atual.estado === 'substituida' || travada)) {
      session.previa = await startPreview(session, { ...options.preview, now: agora });
      logStep(session, 'previa', `rascunho enviado para o site de staging (branch ${session.previa.branch})`);
      await saveSession(root, session);
    } else if (atual) {
      session.previa = await checkPreview(atual, session.plano.destino.path, options.preview);
      if (session.previa.estado !== atual.estado) await saveSession(root, session);
    }
    return draftView(session);
  }
  throw new Error(`sessão em "${session.estado}" ainda não tem rascunho; feche o plano primeiro (faq_status mostra o que falta)`);
}

export async function faqStatus(root, { sessao, requestedBy }, options = {}) {
  const session = await loadSession(root, sessao, { actor: requestedBy, now: options.now });
  // Serviço reiniciou no meio de um turno: a sessão ficou "trabalhando" sem ninguém trabalhando nela.
  if (session.estado === 'trabalhando' && !running.has(session.id)) {
    session.estado = 'falhou';
    session.motivo = 'O serviço reiniciou no meio do trabalho. Chame faq_responder para retomar.';
    await saveSession(root, session);
  }
  return summarize(session, { withLog: true });
}

/** Só para testes: espera o turno em segundo plano terminar. */
export const idle = (sessao) => running.get(sessao) ?? Promise.resolve();
