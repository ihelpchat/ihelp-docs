const click = (role, name) => ({ type: 'click', role, name });
const fill = (name, value) => ({ type: 'fill', role: 'textbox', name, value });
export const taskPlans = {
  'tarefas.buscar': { startRoute: '/tarefas', steps: [fill('Buscar título', 'taskName')],
    persisted: { method: 'GET', path: '/task', field: 'title', value: 'generated' } },
  'tarefas.criar': { startRoute: '/tarefas', steps: [click('button', 'Nova Tarefa'),
    fill('Título', 'taskName'), click('combobox', 'Selecione o responsável'),
    { type: 'click', role: 'option', nameFrom: 'selfOption' }, click('button', 'Salvar')],
    persisted: { method: 'GET', path: '/task', field: 'title', value: 'generated' } },
  'tarefas.editar': { startRoute: '/tarefas?task=:id', steps: [fill('Título', 'editedTaskName'), click('button', 'Salvar')],
    persisted: { method: 'GET', path: '/task', field: 'title', value: 'expected' } },
  'tarefas.concluir': { startRoute: '/tarefas?task=:id', steps: [click('button', 'Concluir')],
    persisted: { method: 'GET', path: '/task', field: 'status', value: 3 } },
  'tarefas.arquivar': { startRoute: '/tarefas?task=:id', steps: [click('button', 'Arquivar')],
    persisted: { method: 'GET', path: '/task', field: 'isArchived', value: true } },
};
export const taskWrites = {
  'tarefas.criar': [{ method: 'POST', path: /^\/task\/?$/u, validator: 'taskCreate',
    keys: ['title', 'description', 'assigneeUserId', 'idRef'], values: ['gerador', '', 'usuário da sessão', 'UUID v4 do front'] }],
  'tarefas.editar': [{ method: 'PUT', path: /^\/task\/(\d+)\/?$/u, created: 1, validator: 'taskEdit',
    keys: ['title', 'description', 'status', 'idRef', 'linkType', 'assigneeUserId'],
    values: ['gerador', '', 1, 'tarefa criada', null, 'usuário da sessão'] }],
  'tarefas.concluir': [{ method: 'PATCH', path: /^\/task\/(\d+)\/status\/?$/u, created: 1, validator: 'taskDone',
    keys: ['status'], values: [3] }],
  'tarefas.arquivar': [{ method: 'POST', path: /^\/task\/(\d+)\/archive\/?$/u, created: 1, validator: 'taskArchive',
    keys: ['isArchived'], values: [true] }],
};
