import { readFile } from 'node:fs/promises';
import actions from '../architecture/product-actions.json' with { type: 'json' };
import guideIds from '../architecture/guide-ids.json' with { type: 'json' };
import { PROCEDURE_ACTIONS } from './gap-classification.mjs';
import { publishedCoverage } from './published-coverage.mjs';
import { pruneSessionEvents } from './session-events.mjs';

export const MIN_GAP_SESSIONS = 3;
const routes = new Map(Object.entries(actions).map(([id, { route }]) => [route, id]));
const canonicalGuides = {
  'importar-contatos': 'guia-importar-contatos', 'abrir-robos': 'robo-de-atendimento',
  'abrir-usuarios': 'usuario-acesso', 'abrir-canais': 'reconectar-canal-qr',
  'abrir-campanhas': 'campanhas', 'abrir-departamentos': 'recado-fora-do-horario',
  'abrir-atendimento': 'arquivos', 'abrir-crm': 'crm',
};
const knownGuides = new Set(guideIds);
const topicOf = (value) => Object.hasOwn(actions, value) ? value : routes.get(value);

async function readEvents(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function entry(map, key, sessionId) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(sessionId);
}
const pair = (topic, action) => JSON.stringify([topic, action]);

/** Read only: grouped counts and closed-vocabulary proposals, never event identity or text. */
export async function collectGaps(root, file, { now = Date.now() } = {}) {
  await pruneSessionEvents(file, { now });
  const documentable = new Map();
  const incidents = new Map();
  const review = new Map();
  for (const event of await readEvents(file)) {
    if (!['partial', 'not_found'].includes(event?.result)
      || typeof event.sessionId !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/iu.test(event.sessionId)) continue;
    const topic = topicOf(event.topic);
    if (['incident', 'permission', 'account_state'].includes(event.issue)) {
      entry(incidents, topic ?? 'unknown', event.sessionId);
    } else if (event.issue !== 'usage') {
      entry(review, pair(topic ?? 'unknown', topic ? 'sem diagnóstico — revisão humana' : 'sem tópico — revisão humana'), event.sessionId);
    } else if (!topic) {
      entry(review, pair('unknown', 'sem tópico — revisão humana'), event.sessionId);
    } else if (!PROCEDURE_ACTIONS.includes(event.action)) {
      entry(review, pair(topic, 'sem ação — revisão humana'), event.sessionId);
    } else {
      entry(documentable, pair(topic, event.action), event.sessionId);
    }
  }
  const catalog = await publishedCoverage(root);
  const proposals = [...documentable].filter(([, sessions]) => sessions.size >= MIN_GAP_SESSIONS).map(([key, sessions]) => {
    const [topic, action] = JSON.parse(key);
    const matches = catalog.filter((page) => page.keys.includes(key));
    if (matches.length > 1) {
      for (const sessionId of sessions) entry(review, pair(topic, 'mais de um guia — revisão humana'), sessionId);
      return null;
    }
    const guideId = matches[0]?.kind === 'guide' ? matches[0].pageId : undefined;
    const pageId = matches[0]?.kind === 'article' ? matches[0].pageId : undefined;
    const target = guideId ?? (catalog.some((page) => page.kind === 'guide' && page.pageId === canonicalGuides[topic])
      ? undefined : canonicalGuides[topic]);
    const registered = target && knownGuides.has(target);
    const { label } = actions[topic];
    return {
      topic, action, sessions: sessions.size, proposal: matches.length ? 'atualizar' : 'criar',
      ...(guideId ? { guideId } : {}),
      ...(pageId ? { pageId } : {}),
      ...(pageId ? {} : registered ? { criar_guia: { guideId: target, topic: `${action} — ${label}`, module: topic,
        description: guideId ? `Revisar o guia publicado sobre ${action} em ${label}.` : `Criar um guia público sobre ${action} em ${label}.` } }
        : { prerequisite: 'Registrar um guideId canônico antes de chamar criar_guia.' }),
    };
  }).filter(Boolean).toSorted((a, b) => pair(a.topic, a.action).localeCompare(pair(b.topic, b.action)));
  const counts = (map, reason) => [...map].filter(([, sessions]) => sessions.size >= MIN_GAP_SESSIONS)
    .map(([topic, sessions]) => ({ topic, sessions: sessions.size, reason }))
    .toSorted((a, b) => a.topic.localeCompare(b.topic));
  return {
    documentable: proposals,
    incidents: counts(incidents, 'incidente — não documentar'),
    review: [...review].filter(([, sessions]) => sessions.size >= MIN_GAP_SESSIONS)
      .map(([key, sessions]) => { const [topic, reason] = JSON.parse(key); return { topic, sessions: sessions.size, reason }; })
      .toSorted((a, b) => a.topic.localeCompare(b.topic)),
  };
}
