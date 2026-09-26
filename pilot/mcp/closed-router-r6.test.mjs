import assert from 'node:assert/strict';
import { publishedGuideCatalog, routeMessage } from './closed-router.mjs';

const catalog = await publishedGuideCatalog(new URL('../', import.meta.url).pathname);
const budget = { file: '/tmp/m5-20-r6-budget.json', dailyLimitUsd: 100, reserveUsd: 0.01 };
const provider = (choice) => ({ responses: { create: async () => ({ status: 'completed',
  output_text: JSON.stringify({ choice }), usage: { input_tokens: 1, output_tokens: 1 } }) } });
const competing = [
  ['Quero cadastrar minha equipe na agenda de plantões', 'usuario-acesso'],
  ['Preciso liberar acesso da equipe ao painel de vendas', 'usuario-acesso'],
  ['Minha atendente só deve ver os pedidos do e-commerce', 'usuario-acesso'],
  ['Quero separar os vendedores por carteira no funil', 'usuario-acesso'],
  ['Preciso cadastrar um funcionário na escala', 'usuario-acesso'],
  ['Como restringir a secretária às conversas marcadas?', 'usuario-acesso'],
  ['Quero dar permissão para minha equipe exportar conversas', 'usuario-acesso'],
  ['Preciso limitar o acesso da vendedora aos pedidos', 'usuario-acesso'],
  ['Meu WhatsApp parou de sincronizar as mensagens do Instagram', 'reconectar-canal-qr'],
  ['O zap caiu na hora de transferir a conversa', 'reconectar-canal-qr'],
  ['Quero reconectar o canal do Instagram', 'reconectar-canal-qr'],
  ['O canal parou de distribuir atendimentos', 'reconectar-canal-qr'],
  ['Preciso ligar de novo a automação do WhatsApp', 'reconectar-canal-qr'],
  ['O WhatsApp parou de mandar pesquisa de satisfação', 'reconectar-canal-qr'],
  ['Não chega mensagem da campanha no WhatsApp', 'reconectar-canal-qr'],
  ['Quero avisar clientes sobre agendamentos quando a loja fechar', 'recado-fora-do-horario'],
  ['Preciso de mensagem automática para confirmar pedidos', 'recado-fora-do-horario'],
  ['Quero um recado de promoção no fim de semana', 'recado-fora-do-horario'],
  ['Como responder sozinho às avaliações dos clientes?', 'recado-fora-do-horario'],
  ['Quero mensagem automática sobre entrega no feriado', 'recado-fora-do-horario'],
];
assert.equal(competing.length, 20);
for (const [question, choice] of competing) {
  assert.deepEqual(await routeMessage(question, { catalog, client: provider(choice), budget }),
    { kind: 'none' }, question);
}
const layQuestions = {
  'reconectar-canal-qr': ['Meu zap caiu e preciso ligar de novo', 'O quadrado com pontinhos apareceu no computador', 'Quero reconectar o WhatsApp da loja', 'Meu canal desconectou ontem', 'Não chega conversa nova no zap', 'Como faço para ler o código no celular?', 'O WhatsApp parou de receber mensagens', 'Preciso conectar de novo o número', 'O celular perdeu a ligação com o iHelp', 'O zap da loja não funciona mais'],
  'usuario-acesso': ['Quero cadastrar uma secretária', 'Minha funcionária só pode ver clientes dela', 'Preciso limitar acesso da vendedora', 'Como separar minha equipe por departamento?', 'Quero criar usuário para meu empregado', 'Minha atendente não pode ver todos os clientes', 'Preciso dar permissão para a nova pessoa', 'Quero colocar a secretária só no setor dela', 'Onde cadastro meu funcionário?', 'Meu vendedor precisa de acesso ao iHelp'],
  'recado-fora-do-horario': ['Quero avisar clientes quando a loja fecha', 'Como deixar mensagem automática à noite?', 'Preciso de recado no domingo', 'Quero uma resposta quando ninguém trabalha', 'O salão fecha às seis; quero avisar quem escreve', 'Como responder sozinho fora do horário?', 'Preciso avisar que estamos de férias', 'Quero recado para quem chamar no feriado', 'Como colocar mensagem quando o expediente acabar?', 'Quando fechar, o cliente precisa receber um aviso'],
};
const totals = { correct: 0, abstained: 0, wrong: 0 };
for (const [choice, questions] of Object.entries(layQuestions)) {
  for (const question of questions) {
    const result = await routeMessage(question, { catalog, client: provider(choice), budget });
    if (result.kind === 'guide' && result.guideId === choice) totals.correct++;
    else if (result.kind === 'none') totals.abstained++;
    else totals.wrong++;
  }
}
assert.equal(totals.correct + totals.abstained + totals.wrong, 30);
assert.equal(totals.wrong, 0, JSON.stringify(totals));
console.log(`M5.20 r6: 20 concorrentes abstidas; 30 leigas: ${JSON.stringify(totals)}`);
