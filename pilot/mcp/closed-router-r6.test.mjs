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
console.log('M5.20 r6: 20 frases concorrentes do revisor abstidas.');
