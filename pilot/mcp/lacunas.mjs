import { readFile } from 'node:fs/promises';
import actions from '../architecture/product-actions.json' with { type: 'json' };
import guideIds from '../architecture/guide-ids.json' with { type: 'json' };
import { publishedGuideCatalog } from './closed-router.mjs';
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
      entry(review, topic ?? 'unknown', event.sessionId);
    } else if (!topic) {
      entry(review, 'unknown', event.sessionId);
    } else {
      entry(documentable, topic, event.sessionId);
    }
  }
  const catalog = await publishedGuideCatalog(root);
  const proposals = [...documentable].filter(([, sessions]) => sessions.size >= MIN_GAP_SESSIONS).map(([topic, sessions]) => {
    const guideId = catalog.find(({ actionIds }) => actionIds.includes(topic))?.guideId;
    const target = guideId ?? canonicalGuides[topic];
    if (!knownGuides.has(target)) return null;
    const { label } = actions[topic];
    return {
      topic, sessions: sessions.size, proposal: guideId ? 'atualizar' : 'criar',
      ...(guideId ? { guideId } : {}),
      criar_guia: { guideId: target, topic: label, module: topic,
        description: guideId ? `Revisar o guia publicado sobre ${label}.` : `Criar um guia público sobre ${label}.` },
    };
  }).filter(Boolean).toSorted((a, b) => a.topic.localeCompare(b.topic));
  const counts = (map, reason) => [...map].filter(([, sessions]) => sessions.size >= MIN_GAP_SESSIONS)
    .map(([topic, sessions]) => ({ topic, sessions: sessions.size, reason }))
    .toSorted((a, b) => a.topic.localeCompare(b.topic));
  return {
    documentable: proposals,
    incidents: counts(incidents, 'incidente — não documentar'),
    review: [
      ...counts(new Map([...review].filter(([topic]) => topic === 'unknown')), 'sem tópico — revisão humana'),
      ...counts(new Map([...review].filter(([topic]) => topic !== 'unknown')), 'sem diagnóstico — revisão humana'),
    ],
  };
}
