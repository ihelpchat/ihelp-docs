import assert from 'node:assert/strict';
import { publishedGuideCatalog, routeMessage } from './closed-router.mjs';

const root = new URL('../', import.meta.url).pathname;
const catalog = await publishedGuideCatalog(root);
const budget = { file: '/tmp/m5-20-r5-budget.json', dailyLimitUsd: 100, reserveUsd: 0.01 };
const provider = (choice) => ({ responses: { create: async () => ({ status: 'completed',
  output_text: JSON.stringify({ choice }), usage: { input_tokens: 1, output_tokens: 1 } }) } });

// A escolha do provider é deliberadamente plausível e errada; a funcionalidade concorrente deve vetá-la.
const reviewer = [
  ['Preciso cadastrar contatos da equipe no CRM', 'usuario-acesso'],
  ['O zap parou de disparar minha campanha', 'reconectar-canal-qr'],
  ['Quero enviar um recado automático de cobrança aos clientes', 'recado-fora-do-horario'],
];
const otherFeatures = [
  ['Preciso cadastrar contatos da equipe no funil', 'usuario-acesso'],
  ['Quero criar usuários para importar contatos', 'usuario-acesso'],
  ['Como limitar acesso à planilha de contatos?', 'usuario-acesso'],
  ['Meu funcionário só pode ver as etiquetas do CRM', 'usuario-acesso'],
  ['Quero cadastrar equipe no pipeline', 'usuario-acesso'],
  ['Preciso dar acesso ao relatório da equipe', 'usuario-acesso'],
  ['O WhatsApp caiu durante o disparo da promoção', 'reconectar-canal-qr'],
  ['Meu zap parou na integração com a API', 'reconectar-canal-qr'],
  ['Como reconectar o robô do WhatsApp?', 'reconectar-canal-qr'],
  ['O canal caiu quando comecei a campanha', 'reconectar-canal-qr'],
  ['Preciso conectar de novo o fluxo do chatbot', 'reconectar-canal-qr'],
  ['O WhatsApp parou de enviar boleto', 'reconectar-canal-qr'],
  ['Quero recado automático para pagamento', 'recado-fora-do-horario'],
  ['Como enviar aviso de cobrança quando a loja fechar?', 'recado-fora-do-horario'],
  ['Preciso de resposta automática para o funil de vendas', 'recado-fora-do-horario'],
  ['Quero mensagem automática sobre importar planilha', 'recado-fora-do-horario'],
  ['Como avisar cliente no feriado com uma campanha?', 'recado-fora-do-horario'],
  ['Preciso responder sozinho sobre etiquetas', 'recado-fora-do-horario'],
  ['Quero mensagem automática para o robô', 'recado-fora-do-horario'],
  ['Como configurar recado fora do horário na API?', 'recado-fora-do-horario'],
];
assert.equal(otherFeatures.length, 20);
for (const [question, chosen] of [...reviewer, ...otherFeatures]) {
  assert.deepEqual(await routeMessage(question, { catalog, client: provider(chosen), budget }),
    { kind: 'none' }, question);
}
console.log('M5.20 r5: 3 contraexemplos do revisor e 20 funcionalidades concorrentes abstidos.');
