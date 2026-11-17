import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Sessão do agente editor: a conversa com quem pediu o FAQ fica em disco,
// porque o transporte HTTP cria um servidor novo a cada requisição.
// Mesmo padrão dos planos de criar_guia: id opaco, TTL, escrita atômica 0600, poda.

export const ESTADOS = ['trabalhando', 'aguardando_usuario', 'plano_pronto', 'rascunho_pronto', 'reprovado',
  'publicando', 'publicado', 'falhou', 'cancelado'];
const TTL_MS = () => Number(process.env.AGENT_SESSION_TTL_MS ?? 72 * 3_600_000);
const safeId = (value) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

async function directory(root) {
  const base = join(process.env.MCP_STATE_DIR ?? root, '.agent-sessions');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const stat = await lstat(base);
  if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('Store de sessões inseguro');
  return base;
}

const fileOf = async (root, id) => {
  if (!safeId(id)) throw new Error('sessão inválida');
  return join(await directory(root), `${id}.json`);
};

export async function saveSession(root, session) {
  const file = await fileOf(root, session.id);
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(session), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
  return session;
}

export async function createSession(root, { pedido, modulo = null, criadaPor }, { now = Date.now() } = {}) {
  await pruneSessions(root, now);
  return saveSession(root, {
    id: randomBytes(16).toString('hex'), criadaPor, pedido, modulo,
    criadaEm: new Date(now).toISOString(), expiraEm: new Date(now + TTL_MS()).toISOString(),
    estado: 'trabalhando', motivo: null, plano: null, planoAceito: false,
    perguntas: [], respostas: [], sugestoes: [], achados: [], lidas: [], destinoConfirmado: false,
    modo: 'plano', codigo: [], tentativasEscrita: 0,
    rascunho: null, publicacao: null, custoUsd: 0, passos: 0, buscas: 0, log: [],
  });
}

export async function loadSession(root, id, { actor, now = Date.now() } = {}) {
  const file = await fileOf(root, id);
  let session;
  try { session = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('sessão não encontrada ou expirada');
    throw error;
  }
  if (now >= Date.parse(session.expiraEm)) { await rm(file, { force: true }); throw new Error('sessão não encontrada ou expirada'); }
  if (actor && session.criadaPor !== actor) throw new Error('sessão pertence a outro ator');
  return session;
}

export async function pruneSessions(root, now = Date.now()) {
  const base = await directory(root);
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{32}\.json$/.test(entry.name)) continue;
    const file = join(base, entry.name);
    const expiry = await readFile(file, 'utf8').then((raw) => Date.parse(JSON.parse(raw).expiraEm)).catch(() => 0);
    if (!(now < expiry)) await rm(file, { force: true });
  }
}

export function logStep(session, tipo, resumo, now = Date.now()) {
  session.log.push({ em: new Date(now).toISOString(), tipo, resumo: String(resumo).slice(0, 300) });
  if (session.log.length > 200) session.log.splice(0, session.log.length - 200);
}

// O que volta para quem chamou o MCP. Nunca inclui trecho de código nem texto de fonte interna:
// só o plano, as perguntas e o resumo do que o agente fez.
export function summarize(session, { withLog = false } = {}) {
  return {
    sessao: session.id, estado: session.estado, ...(session.motivo ? { motivo: session.motivo } : {}),
    pedido: session.pedido, plano: session.plano,
    perguntas: session.perguntas.filter(({ id }) => !session.respostas.some(({ perguntaId }) => perguntaId === id)),
    ...(session.estado === 'plano_pronto' ? { proximo: session.plano?.acao === 'nada' ? 'Nada a escrever: o conteúdo já existe.'
      : 'Plano fechado. Chame faq_rascunho para escrever, ou mande uma sugestão por faq_responder para ajustar.' } : {}),
    ...(['rascunho_pronto', 'reprovado'].includes(session.estado) ? { proximo: 'Veja o texto e o resultado dos juízes em faq_rascunho. Para ajustar, mande uma sugestão por faq_responder.' } : {}),
    ...(session.rascunho ? { rascunho: { revisao: session.rascunho.revisao, aprovado: session.rascunho.gates.aprovado } } : {}),
    custoUsd: Number(session.custoUsd.toFixed(4)), passos: session.passos, expiraEm: session.expiraEm,
    ...(withLog ? { log: session.log } : {}),
  };
}

// O rascunho como quem pediu vê: texto público e resultado dos juízes. Os motivos dos juízes ficam com o agente,
// porque podem parafrasear fonte interna.
export function draftView(session) {
  const { revisao, mdx, gates, pendencias } = session.rascunho;
  const previa = session.previa?.revisao === revisao ? session.previa : null;
  const aviso = !previa ? (gates.aprovado ? 'Para ver no layout do site, chame faq_rascunho com previa: true. O texto vai para uma branch pública e para o site de staging.' : 'Prévia só para rascunho aprovado.')
    : previa.estado === 'publicando' ? 'O site de staging está sendo publicado (alguns minutos). Chame faq_rascunho de novo para conferir; se passar de 15 minutos, chame com previa: true para republicar.'
      : previa.estado === 'substituida' ? 'Outra publicação entrou no staging por cima desta prévia. Chame faq_rascunho com previa: true para republicar.' : null;
  return { sessao: session.id, estado: session.estado, ...(session.motivo ? { motivo: session.motivo } : {}),
    revisao, mdx, gates, pendencias, previewUrl: previa?.estado === 'pronta' ? previa.previewUrl : null,
    ...(aviso ? { previa: aviso } : {}), custoUsd: Number(session.custoUsd.toFixed(4)) };
}
