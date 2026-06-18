---
title: "Buscar histórico de mensagens"
sidebar_position: 5
---

Busca mensagens por um **chatId**. Pode paginar usando skip e quantidade.

:::warning[Atenção]
`chatId` não é o `idRef` ou `atendimentoId`. É o campo `chatId` nos metadados do atendimento.
:::

GET
```http
https://apiv3.ihelpchat.com/api/v2/customers/chat/<chatId>?skip=0&limit=30
```

Ex:
Página 1 (0 -> 30): retorna as 30 mensagens mais recentes
```http
https://apiv3.ihelpchat.com/api/v2/customers/chat/69cbd0e89c48a050e8a169b9?skip=0&limit=30
```
Página 2 (30 -> 60)
```http
https://apiv3.ihelpchat.com/api/v2/customers/chat/69cbd0e89c48a050e8a169b9?skip=30&limit=30
```

```json
  {
    "dados": {
      "id": "69cbd0e89c48a050e8a169b9",
      "chatRobo": false,
      "chatRoboDataInicio": "0001-01-01T00:00:00Z",
      "idExterno": "556799114485",
      "contatoWhatsApp": "556799114485",
      "notificacoes": 0,
      "canalId": "686fb423b452efcf9e115c95",
      "ultimaMensagem": "Passando para confirmar a nossa reunião, que ocorrerá daqui a pouco, às 10h.\n",
      "ultimaMensagemData": "2026-04-06T12:57:20.924Z",
      "ultimaMensagemDirecao": 1,
      "ultimaMensagemStatus": 3,
      "created": "2026-03-31T13:49:28.337Z",
      "totalMessages": 20,
      "mensagens": [
        {
          "id": "69d3adb3a2c285ac12362d8f",
          "texto": "Passando para confirmar a nossa reunião, que ocorrerá daqui a pouco, às 10h.\n",
          "audioTranscribeStatus": 0,
          "contactCards": [],
          "ackStatus": 3,
          "userName": "Bruna Fernandes",
          "dataEnvio": "2026-04-06T12:57:20.924Z",
          "dataRecebimento": "0001-01-01T00:00:00Z",
          "direcao": 1,
          "editedMessage": false,
          "forward": false,
          "idExterno": "3EB035E9D8262F4DAFBBD9",
          "messageType": 16,
          "mensagemPersonalizadaId": 0,
          "atendimentoId": "69ce86564040d7306dc885e8",
          "departamentoId": "5f3eb6eac8691640b84b6f5e",
          "canalId": "686fb423b452efcf9e115c95",
          "chatId": "000000000000000000000000",
          "chatMessageId": "000000000000000000000000",
          "created": "2026-04-06T12:57:20.924Z",
          "deleted": false,
          "isStatus": false,
          "orderItemCount": 0
        },
        {
          "id": "69d3acf13655b7c06be06bd1",
          "texto": "Bom dia Jane",
          "audioTranscribeStatus": 0,
          "contactCards": [],
          "ackStatus": 3,
          "userName": "Bruna Fernandes",
          "dataEnvio": "2026-04-06T12:54:07.123Z",
          "dataRecebimento": "0001-01-01T00:00:00Z",
          "direcao": 1,
          "editedMessage": false,
          "forward": false,
          "idExterno": "3EB02CADA41AF8D3129BA5",
          "messageType": 16,
          "mensagemPersonalizadaId": 0,
          "atendimentoId": "69ce86564040d7306dc885e8",
          "departamentoId": "5f3eb6eac8691640b84b6f5e",
          "canalId": "686fb423b452efcf9e115c95",
          "chatId": "000000000000000000000000",
          "chatMessageId": "000000000000000000000000",
          "created": "2026-04-06T12:54:07.123Z",
          "deleted": false,
          "isStatus": false,
          "orderItemCount": 0
        },
        {
          "id": "69cec45bda822797821ac9ea",
          "texto": "Sua reunião com nosso especialista foi agendada:✅\n\nData: | 06/04/2026 - Segunda-Feira\nHorário: 10:00 (de Brasília)\n\nSala:\nhttps://meet.google.com/bud-zncg-wbb\n\nEspecialista: Bruno Barbosa",
          "audioTranscribeStatus": 0,
          "contactCards": [],
          "ackStatus": 4,
          "userName": "Bruna Fernandes",
          "dataEnvio": "2026-04-02T19:32:43.3Z",
          "dataRecebimento": "0001-01-01T00:00:00Z",
          "direcao": 1,
          "editedMessage": false,
          "forward": false,
          "idExterno": "3EB009056BEB8286D2D5DB",
          "messageType": 16,
          "mensagemPersonalizadaId": 0,
          "atendimentoId": "69ce86564040d7306dc885e8",
          "departamentoId": "5f3eb6eac8691640b84b6f5e",
          "canalId": "686fb423b452efcf9e115c95",
          "chatId": "000000000000000000000000",
          "chatMessageId": "000000000000000000000000",
          "created": "2026-04-02T19:32:43.3Z",
          "deleted": false,
          "isStatus": false,
          "orderItemCount": 0
        }
      ],
      "nextChatMessage": "69cebd9f4f6e844e1628d592"
    }
  }
```

----
