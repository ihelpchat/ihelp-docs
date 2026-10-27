const click = (role, name) => ({ type: 'click', role, name });
const fill = (name, value) => ({ type: 'fill', role: 'textbox', name, value });
// O POST /marketing exige contatos, canal e mensagem; não existe save draft no wizard.
export const campaignPlans = {
  'campanhas.buscar': { startRoute: '/campanhas', steps: [fill('Buscar campanhas...', 'campaignName')],
    persisted: { method: 'GET', path: '/marketing/campaigns', idField: 'idRef', idSource: 'campaign', field: 'titulo', value: 'generated' } },
  'campanhas.alternar_visualizacao': { startRoute: '/campanhas', steps: [click('button', 'Modo lista')],
    persisted: { method: 'GET', path: '/marketing/campaigns', idField: 'idRef', idSource: 'campaign', field: 'titulo', value: 'generated' } },
  'campanhas.consultar_detalhe': { startRoute: '/campanhas/detalhe/:idRef', steps: [],
    persisted: { method: 'GET', path: '/marketing/campaigns/:id', idField: 'idRef', idSource: 'campaign', field: 'titulo', value: 'generated' } },
};
