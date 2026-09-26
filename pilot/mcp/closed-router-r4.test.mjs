import assert from 'node:assert/strict';
import { publishedGuideCatalog, routeMessage } from './closed-router.mjs';
import { requestsHuman } from './guide-state.mjs';
import { answerQuestion } from './assistant-service.mjs';

const root = new URL('../', import.meta.url).pathname;
const catalog = await publishedGuideCatalog(root);
const budget = { file: '/tmp/m5-20-r4-budget.json', dailyLimitUsd: 100, reserveUsd: 0.01 };
const provider = (choice) => ({ responses: { create: async () => ({ status: 'completed',
  output_text: JSON.stringify({ choice }), usage: { input_tokens: 1, output_tokens: 1 } }) } });

const cases = {
  'reconectar-canal-qr': [
    'O zap parou, apareceu um quadrado com pontinhos',
    'Preciso ligar de novo o WhatsApp da loja',
    'Meu zap caiu ontem',
    'O WhatsApp da loja não chega mensagem',
    'Como reconectar o canal?',
    'O celular desconectou do iHelp',
    'Quero ler o código no celular',
    'O canal não voltou a funcionar',
    'O whats parou de funcionar',
    'Quero conectar de novo o zap',
  ],
  'usuario-acesso': [
    'Minha secretária só pode ver os clientes dela',
    'Cadastrar minha secretária só com os clientes do setor dela',
    'Quero restringir o acesso do vendedor',
    'Como limitar a permissão do funcionário?',
    'O atendente só deve ver seu departamento',
    'Quero separar os clientes por usuário',
    'Minha equipe precisa de acesso por departamento',
    'Como gerenciar usuário e acesso?',
    'A secretária pode só ver o setor dela?',
    'Colocar uma pessoa da equipe no departamento dela',
  ],
  'recado-fora-do-horario': [
    'Quero avisar quando a loja fechar',
    'Preciso de recado fora do horário',
    'A mensagem automática deve responder no fim de semana',
    'Quero responder sozinho quando a loja fechar',
    'Como avisar o cliente no feriado?',
    'NÃO é campanha: quero resposta automática quando o salão está fechado',
    'Como deixar recado fora do horário no domingo?',
    'Quero mensagem quando a loja fechar',
    'O cliente precisa receber aviso fora do horário',
    'Quero recado automático no feriado',
  ],
};
for (const [guideId, questions] of Object.entries(cases)) {
  assert.equal(questions.length, 10);
  for (const question of questions) {
    assert.deepEqual(await routeMessage(question, { catalog, client: provider(guideId), budget }),
      { kind: 'guide', guideId }, question);
  }
}

for (const question of [
  'Quero fazer campanha no zap',
  'Preciso disparar uma campanha no WhatsApp',
  'Quero importar contatos da minha equipe',
  'Como cadastrar contatos no CRM?',
  'Quero automatizar o robô no WhatsApp',
  'Como enviar promoção aos clientes?',
  'Quero criar um funil no CRM',
  'Onde vejo as campanhas antigas?',
  'Preciso importar planilha de clientes',
  'Quero configurar o robô de vendas',
]) {
  for (const guideId of Object.keys(cases)) {
    assert.deepEqual(await routeMessage(question, { catalog, client: provider(guideId), budget }),
      { kind: 'none' }, `${question}: ${guideId}`);
  }
}

const human = 'Pode me colocar com suporte para configurar o canal?';
assert.equal(requestsHuman(human), true, human);
const reply = await answerQuestion(root, human, { apiKey: '' });
assert.ok(reply.escalation || reply.actions?.some((action) => action.destination === 'support'), human);
console.log('M5.20 r4: ação + objeto, abstenção e handoff explícito.');
