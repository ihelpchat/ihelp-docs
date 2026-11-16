import assert from 'node:assert/strict';
import { personVoiceSuggestions } from './assistant-service.mjs';

// Ao clicar, a sugestão vira mensagem da pessoa: nada de perguntas do assistente para ela.
assert.deepEqual(
  personVoiceSuggestions([
    'Quer que eu guie você passo a passo?',
    'Você encontrou o botão Conectar?',
    'Como confirmo que deu certo?',
  ], 'Posso te acompanhar pela tela. Quer que eu te guie?'),
  ['Sim, me guie passo a passo', 'Como confirmo que deu certo?'],
);

// Sem pergunta da IA no fim da resposta, a oferta vira pedido direto (sem "Sim" solto).
assert.deepEqual(
  personVoiceSuggestions(['Deseja que eu te guie etapa por etapa?'], 'Siga os passos abaixo.'),
  ['Me guie passo a passo'],
);

// Perguntas da própria pessoa passam intactas, inclusive com "posso".
assert.deepEqual(
  personVoiceSuggestions(['Posso usar o mesmo número?', 'Quais filas posso acessar?', 'Me guie passo a passo']),
  ['Posso usar o mesmo número?', 'Quais filas posso acessar?', 'Me guie passo a passo'],
);

// Pergunta do assistente sem oferta de guia é descartada; duplicatas somem.
assert.deepEqual(
  personVoiceSuggestions(['Você já tem o QR code em mãos?', 'Gostaria de saber mais sobre planos?', 'Quer que eu te guie?', 'Pode me guiar?'], 'Quer ajuda?'),
  ['Gostaria de saber mais sobre planos?', 'Sim, me guie passo a passo', 'Pode me guiar?'],
);

console.log('suggestions-person-voice: ok');
