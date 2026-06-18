---
title: "Transcrever áudio"
sidebar_position: 6
---

POST
```http
https://apiv3.ihelpchat.com/api/v2/customers/transcribe-audio
```

Body:
```json
{
"chatId":"6998a749e43234444248cd03",
"messageId":"69d7eaadef4aaf4182380a22"
}
```
Response:

:::warning[A resposta virá vazia]
Após gerar a transcrição, é necessário fazer o fetch de mensagens (Etapa 2 abaixo).
:::

```
{}
```

### Etapa 2: Buscar o valor da transcrição do audio

GET
```http
https://apiv3.ihelpchat.com/api/v2/customers/chat/<chatId>?skip=0&limit=30
```
- retornará as 30 últimas mensagens (exemplo)
Filtre o array de mensagens por um ou por ambas as chaves abaixo:
```
dados.mensagens[N].audioTranscribeStatus 
dados.mensagens[N].audioTranscribeText
```
ex:
```
 "audioTranscribeStatus": 1,
 "audioTranscribeText": "Teste, um, dois, três, teste, teste, um, dois, três.",
```
Response example:
```json
  {
    "dados": {
      "id": "6998a749e43234444248cd03",
      "chatRobo": false,
      "chatRoboDataInicio": "0001-01-01T00:00:00Z",
      "idExterno": "573171952502",
      "contatoWhatsApp": "573171952502",
      "notificacoes": 0,
      "canalId": "6855aa5b2c20fcca6b48bee9",
      "ultimaMensagem": "Legal, entendido 😊  \nE hoje, quantas pessoas da sua equipe usam o WhatsApp para falar com clientes aí?",
      "ultimaMensagemData": "2026-04-09T18:06:56.465Z",
      "ultimaMensagemDirecao": 1,
      "ultimaMensagemStatus": 4,
      "created": "2026-02-20T18:26:17.478Z",
      "totalMessages": 20,
      "mensagens": [
        
        {
          "id": "69d7eaadef4aaf4182380a22",
          "mediaUrl": "medias/08dd125a-55b2-4e4a-912d-1d0386904a7e.ogg",
          "audioTranscribeStatus": 1,
          "audioTranscribeText": "Teste, um, dois, três, teste, teste, um, dois, três.",
          "contactCards": [],
          "ackStatus": 0,
          "dataEnvio": "2026-04-09T18:06:37.001Z",
          "dataRecebimento": "2026-04-09T18:06:37.001Z",
          "direcao": 0,
          "editedMessage": false,
          "forward": false,
          "idExterno": "wamid.HBgMNTczMTcxOTUyNTAyFQIAEhggQTUxQTdERjBGQTk0QUM4QkJDQ0JBRDVBM0IzRTRDNTgA",
          "messageType": 4,
          "mensagemPersonalizadaId": 0,
          "atendimentoId": "69cd22ca7f19b2863d950e01",
          "departamentoId": "671937dbb541238154145b7e",
          "canalId": "6855aa5b2c20fcca6b48bee9",
          "chatId": "000000000000000000000000",
          "chatMessageId": "000000000000000000000000",
          "created": "2026-04-09T18:06:37.001Z",
          "deleted": false,
          "isStatus": false,
          "orderItemCount": 0
        },
        
      ],
      "nextChatMessage": "69cd7e3c4040d7306d550173",
      "lastContactMessageTime": "2026-04-09T18:06:37.001Z"
    }
  }
```

----------
