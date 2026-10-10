import { crmPlans, crmWrites } from './crm.mjs';
import { campaignPlans } from './campanhas.mjs';
import { schedulePlans } from './agendamentos.mjs';
import { taskPlans, taskWrites } from './tarefas.mjs';

export const areaPlans = Object.freeze({ ...crmPlans, ...campaignPlans, ...schedulePlans, ...taskPlans });
export const areaWriteRules = Object.freeze({ ...crmWrites, ...taskWrites });
export function areaFixtureValue(kind, { marker = '', scheduleDay, selfOption, contactOption,
  stageName, selfLabel } = {}) {
  if (marker && !/^[a-f0-9]{8}$/u.test(marker)) throw new Error('marcador inválido');
  const tag = marker ? ` · ${marker}` : '';
  if (kind === 'cardName') return `Card Exemplo 01${tag}`;
  if (kind === 'campaignName') return `Campanha Exemplo 01${tag}`;
  if (kind === 'noteText') return `Nota Exemplo 01${tag}`;
  if (kind === 'taskName') return `Tarefa Exemplo 01${tag}`;
  if (kind === 'editedTaskName') return `Tarefa Exemplo 01 Editada${tag}`;
  if (kind === 'scheduleDay' && Number.isInteger(scheduleDay) && scheduleDay >= 1 && scheduleDay <= 31)
    return String(scheduleDay);
  if (kind === 'selfOption' && /^opção [1-9]\d{0,2}$/u.test(selfOption ?? '')) return selfOption;
  if (kind === 'contactOption' && /^opção [1-9]\d{0,2}$/u.test(contactOption ?? '')) return contactOption;
  if (kind === 'stageName' && /^Etapa Exemplo \d{2}$/u.test(stageName ?? '')) return stageName;
  if (kind === 'selfLabel' && /^Atendente Exemplo \d{2}$/u.test(selfLabel ?? '')) return selfLabel;
  throw new Error('fixture de área ausente');
}
const owns = (set, value) => set instanceof Set && (set.has(value) || set.has(Number(value)));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const shape = (value, allowed, required = []) => object(value)
  && Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key));
const fromGenerator = (context, value) => typeof value === 'string' && context.generated?.has(value);
const uuid = (value) => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);

const validators = {
  crmCreate: (body, context) => shape(body,
    ['title', 'description', 'stageId', 'funnelId', 'contactId', 'responsibleId', 'estimatedValue',
      'closureDate', 'dueDate', 'status', 'order', 'id', 'createdDate', 'priority'],
    ['title', 'stageId', 'funnelId', 'contactId', 'responsibleId', 'status', 'id'])
    && fromGenerator(context, body.title) && /^Card Exemplo \d{2}(?: · [a-f0-9]{8})?$/u.test(body.title)
    && (body.description == null || body.description === '')
    && owns(context.fixedIds?.stage, body.stageId) && owns(context.fixedIds?.funnel, body.funnelId)
    && owns(context.fixedIds?.contact, body.contactId) && owns(context.fixedIds?.self, body.responsibleId)
    && (body.estimatedValue == null || body.estimatedValue === 0)
    && (body.closureDate == null) && (body.dueDate == null)
    && body.status === 2 && body.order === 0 && body.id === 0 && body.priority == null
    && (body.createdDate == null || typeof body.createdDate === 'string'
      && Number.isFinite(Date.parse(body.createdDate)) && Math.abs(Date.now() - Date.parse(body.createdDate)) < 600_000),
  taskCreate: (body, context) => shape(body, ['title', 'description', 'assigneeUserId', 'idRef'],
    ['title', 'assigneeUserId', 'idRef'])
    && fromGenerator(context, body.title) && /^Tarefa Exemplo \d{2}(?: · [a-f0-9]{8})?$/u.test(body.title)
    && (body.description == null || body.description === '' || fromGenerator(context, body.description))
    && owns(context.fixedIds?.self, body.assigneeUserId) && uuid(body.idRef)
    && !owns(context.createdIds, body.idRef),
  taskEdit: (body, context) => shape(body, ['title', 'description', 'status', 'idRef', 'linkType', 'assigneeUserId'], ['title', 'idRef', 'assigneeUserId'])
    && fromGenerator(context, body.title) && /^Tarefa Exemplo \d{2}(?: Editada)?(?: · [a-f0-9]{8})?$/u.test(body.title)
    && (body.description == null || body.description === '' || fromGenerator(context, body.description))
    && (body.status == null || body.status === 1) && owns(context.createdIds, body.idRef)
    && owns(context.fixedIds?.self, body.assigneeUserId) && body.linkType == null,
  taskDone: (body) => shape(body, ['status'], ['status']) && body.status === 3,
  taskArchive: (body) => shape(body, ['isArchived'], ['isArchived']) && body.isArchived === true,
  crmNote: (body, context, match) => shape(body, ['cardId', 'title', 'description', 'isPrivate'],
    ['cardId', 'title', 'description', 'isPrivate']) && Number(body.cardId) === Number(match[1])
    && body.title === '' && fromGenerator(context, body.description)
    && /^Nota Exemplo \d{2}(?: · [a-f0-9]{8})?$/u.test(body.description) && body.isPrivate === false,
};

export function areaWriteAllowed(request, context = {}) {
  if (!areaWriteRules[context.taskId]) return false;
  let url;
  try { url = new URL(request.url()); } catch { return false; }
  if (!context.apiOrigin || url.origin !== context.apiOrigin || url.search || url.hash) return false;
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.()['content-type'] ?? '')) return false;
  const path = url.pathname.replace(/^\/api(?:\/v2)?(?=\/)/u, '');
  const raw = request.postData?.();
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 20_000) return false;
  let body;
  try { body = JSON.parse(raw); } catch { return false; }
  for (const rule of areaWriteRules[context.taskId]) {
    if (rule.method !== request.method().toUpperCase()) continue;
    const match = path.match(rule.path);
    if (!match) continue;
    if (rule.created && !owns(context.createdIds, match[rule.created])) return false;
    if (rule.card && !owns(context.fixedIds?.card, match[rule.card])) return false;
    if (rule.stage && !owns(context.fixedIds?.stage, match[rule.stage])) return false;
    return validators[rule.validator](body, context, match);
  }
  return false;
}

export function nextAreaAction(id, screen, actions, fixtureFor) {
  const plan = areaPlans[id];
  if (!plan) return null;
  const label = (step) => step.nameFrom ? String(fixtureFor(step.nameFrom)) : step.name;
  const matches = (step, name) => ['scheduleDay', 'campaignName', 'stageName'].includes(step.nameFrom)
    ? name === label(step) || name.startsWith(`${label(step)} `)
    : step.nameFrom === 'selfLabel' ? name === label(step) || name.endsWith(` ${label(step)}`)
      : name === label(step);
  const done = (step) => actions.some((action) => action.type === step.type
    && action.role === step.role && matches(step, action.name)
    && (step.type !== 'fill' || action.value === fixtureFor(step.value)));
  const step = plan.steps.find((item) => !done(item));
  if (!step) return { type: 'finish', role: null, name: null, value: null };
  const target = step.type === 'fill'
    ? screen.fields?.find((item) => item.role === step.role && matches(step, item.name))
    : screen.controls?.find((item) => item.enabled && item.role === step.role && matches(step, item.name));
  return target ? { type: step.type, role: step.role, name: target.name,
    value: step.type === 'fill' ? fixtureFor(step.value) : null } : null;
}

// Conferir a leitura posterior à escrita, não apenas o status do POST/PATCH.
export function verifyAreaResult(id, response, context = {}) {
  const plan = areaPlans[id];
  if (!plan || response?.status !== 200 || response.method !== 'GET') return false;
  let path;
  try {
    const url = new URL(response.url);
    if (context.apiOrigin && url.origin !== context.apiOrigin) return false;
    path = url.pathname.replace(/^\/api(?:\/v2)?(?=\/)/u, '');
  }
  catch { return false; }
  const pattern = new RegExp(`^${plan.persisted.path.replace(/:[A-Za-z]+/gu, '[^/]+')}/?$`, 'u');
  if (!pattern.test(path)) return false;
  const payload = response.body?.dados ?? response.body?.data ?? response.body;
  const rows = Array.isArray(payload) ? payload : object(payload) ? [payload] : [];
  const { field, value, idField = 'id', idSource = 'createdIds' } = plan.persisted;
  const allowedIds = idSource === 'createdIds' ? context.createdIds : context.fixedIds?.[idSource];
  return rows.filter((row) => object(row) && owns(allowedIds, row[idField])
    && (value === 'generated' ? fromGenerator(context, row[field])
      : value === 'stage' ? owns(context.fixedIds?.stage, row[field])
        : value === 'positive' ? Number.isInteger(row[field]) && row[field] > 0
          : row[field] === value)).length === 1;
}
