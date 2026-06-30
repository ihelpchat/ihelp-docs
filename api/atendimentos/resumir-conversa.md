---
title: "Resumir conversa"
sidebar_position: 3
---

Chamar esse endpoint irá resumir a conversa com o prompt fixo: `Crie um resumo do atendimento, esse resumo deverá ter em torno de 5 linhas.`

- No body json do Atendimento, **a chave "idRef"** é o valor que você deve passar para o **"atendimentoId"** no body abaixo; 
- A chave **"chatId"** terá o id para passar em **"chatId"** no body abaixo.

POST
```
https://apiv3.ihelpchat.com/api/v2/ai/summary
```

Body:
```json
{
"atendimentoId": "69af1000000002b1de0a38",
"chatId": "66db18676100000000e9a419" 
}
```

Response example:
```json
{
  "dados": {
    "summary": "Durante o atendimento, o cliente relatou uma dúvida sobre o funcionamento do sistema. O atendente explicou o comportamento esperado, esclareceu o ponto levantado e se comprometeu a verificar os ajustes necessários. Ao final, foi oferecido suporte adicional para que o cliente concluísse a configuração de acordo com as preferências dele.",
    "mood": "3"
  }
}
```

----
