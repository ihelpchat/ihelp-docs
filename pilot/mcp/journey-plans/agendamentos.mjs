// A área é calendário de mensagens; criar ou editar compromissos internos não existe nela.
export const schedulePlans = {
  'agendamentos.consultar_mes': { startRoute: '/agendamentos', steps: [],
    persisted: { method: 'GET', path: '/ScheduledMessages/calendar/amount-per-day', idField: 'monthDay', idSource: 'scheduleDay', field: 'amount', value: 'positive' } },
  'agendamentos.consultar_dia': { startRoute: '/agendamentos', steps: [{ type: 'click', role: 'button', nameFrom: 'scheduleDay' }],
    persisted: { method: 'GET', path: '/ScheduledMessages/calendar/schedules/:date', idField: 'idRef', idSource: 'schedule', field: 'sent', value: false } },
  'agendamentos.consultar_estado': { startRoute: '/agendamentos', steps: [{ type: 'click', role: 'button', nameFrom: 'scheduleDay' }],
    persisted: { method: 'GET', path: '/ScheduledMessages/calendar/schedules/:date', idField: 'idRef', idSource: 'schedule', field: 'sent', value: false } },
};
