const click = (role, name) => ({ type: 'click', role, name });
const fill = (name, value) => ({ type: 'fill', role: 'textbox', name, value });
export const crmPlans = {
  'crm.criar_card': { startRoute: '/crm/pipeline', steps: [click('button', 'Adicionar oportunidade'),
    fill('Título do card', 'cardName'),
    { type: 'click', role: 'button', nameFrom: 'stageName' },
    { type: 'click', role: 'option', nameFrom: 'contactOption' },
    { type: 'click', role: 'button', nameFrom: 'selfLabel' }, click('button', 'Criar card')],
    persisted: { method: 'GET', path: '/crm/card/:id', idField: 'id', field: 'title', value: 'generated' } },
  'crm.localizar_card': { startRoute: '/crm/pipeline', steps: [fill('Buscar cards…', 'cardName')],
    persisted: { method: 'GET', path: '/crm/card/:id', idField: 'id', idSource: 'card', field: 'title', value: 'generated' } },
  'crm.abrir_card': { startRoute: '/crm/card/:id', steps: [],
    persisted: { method: 'GET', path: '/crm/card/:id', idField: 'id', idSource: 'card', field: 'title', value: 'generated' } },
  'crm.adicionar_nota': { startRoute: '/crm/card/:id', steps: [click('tab', 'Notas'),
    fill('Descrição da nota', 'noteText'), click('button', 'Adicionar nota')],
    persisted: { method: 'GET', path: '/crm/card/:id/notes', idField: 'cardId', idSource: 'card', field: 'description', value: 'generated' } },
  'crm.consultar_etapas': { startRoute: '/crm/pipeline', steps: [],
    persisted: { method: 'GET', path: '/crm/card/:id', idField: 'id', idSource: 'card', field: 'stageId', value: 'stage' } },
};
export const crmWrites = {
  'crm.criar_card': [{ method: 'POST', path: /^\/crm\/card\/?$/u, validator: 'crmCreate',
    keys: ['title', 'description', 'stageId', 'funnelId', 'contactId', 'responsibleId', 'estimatedValue',
      'closureDate', 'dueDate', 'status', 'order', 'id', 'createdDate', 'priority'],
    values: ['gerador', 'fixtures opacas', 'usuário da sessão', 0, 2] }],
  'crm.adicionar_nota': [{ method: 'POST', path: /^\/crm\/card\/(\d+)\/notes\/?$/u, card: 1, validator: 'crmNote',
    keys: ['cardId', 'title', 'description', 'isPrivate'], values: ['card fixture', 'gerador', false] }],
};
