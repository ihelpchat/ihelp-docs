---
title: "Buscar metadados do atendimento"
sidebar_position: 2
---

Buscar **todos os metadados** de um atendimento: 

- **idRef (id de atendimento)** - podem haver vários idRefs para um contato. Quando um atendimento é encerrado, e criamos outro atendimento novo, o idRef será diferente.
- **chatId (id do chat do contato)** - esse id sempre será o mesmo para o mesmo contato. A principal função desse chatId será buscar o histórico de mensagens do usuário.
- **Outros metadados: todos os dados relevantes** de um atendimento - id do contato, datas de abertura, última mensagem, id do canal, departamento, status, entre outros.

----

1. Abra o atendimento no ihelp
2. Copie o idRef na URL do site (o id longo na barra de URL após **?call=** 
    1. exemplo: **69d3b6d4a33b5d339bdf69a5**
3. Faça a requisição GET:
```http
https://apiv3.ihelpchat.com/api/v2/customers/call-chat/<idRef>
```

Response example:
```json
{
    "dados": {
        "id": 20669401,
        "ativo": false,
        "atendimentoTransferido": false,
        "chatIdExterno": "558588995809",
        "chatImagemPerfil": "https://images.ihelpchat.com/medias/f733946d-fb9e-449e-88a1-d5e9a0da5341.jpg",
        "chatNome": "",
        "chatUltimaMensagem": "Ok, obrigada",
        "chatUltimaMensagemTipoMensagem": 0,
        "chatUltimaMensagemData": "2026-04-06T13:37:02Z",
        "chatUltimaMensagemDirecao": 0,
        "chatUltimaMensagemStatus": 0,
        "chatNotificacoes": 1,
        "canalId": 2,
        "departamentoId": 1,
        "statusId": 0,
        "chatId": "69d3b6d4a33b5d339bdf69a9",
        "contatoId": 5080632,
        "idRef": "69d3b6d4a33b5d339bdf69a5",
        "tipoAtendimento": 1,
        "customerMood": 0,
        "createdDate": "2026-04-06T13:36:22Z",
        "endDate": "2026-04-06T13:42:17.515778Z",
        "priority": false,
        "customizedFilterId": 0,
        "channelTitle": "17 99261-0896 | iHelp Comercial | Geral",
        "channelNumber": "5517992610896",
        "channelType": 1,
        "channelProvider": 0,
        "cloudApi": false,
        "departmentTitle": "Vendas",
        "contato": {
            "id": 5080632,
            "nome": "",
            "empresaId": 1,
            "idRef": "69d3b6d5a33b5d339bdf69fd",
            "saved": false
        },
        "atendimentoUsuarios": [
            {
                "id": 15858065,
                "atendimentoId": 20669401,
                "userId": 11011,
                "idRef": "69d3b6d6a33b5d339bdf6a02",
                "usuario": {
                    "status": true,
                    "usuarioPerfil": 1,
                    "ocultarAbaDepartamento": true,
                    "ocultarAbaFinalizados": false,
                    "ocultarMenuMarketing": true,
                    "ocultarMenuRelatorio": false,
                    "ocultarAbaRobo": false,
                    "notificacoes": true,
                    "audioNotificacao": "sound3.mp3",
                    "hideContactMenu": false,
                    "canReopen": false,
                    "id": 11011,
                    "nome": "Bruna Fernandes",
                    "idRef": "69baf84c45034f6a32f14846"
                }
            }
        ],
        "chat": {
            "id": "69d3b6d4a33b5d339bdf69a9",
            "chatRobo": false,
            "chatRoboDataInicio": "0001-01-01T00:00:00Z",
            "idExterno": "558588995809",
            "contatoWhatsApp": "558588995809",
            "notificacoes": 0,
            "canalId": "614bcca35a328d0a32375f13",
            "ultimaMensagem": "Ok, obrigada",
            "ultimaMensagemData": "2026-04-06T13:37:02.61Z",
            "ultimaMensagemDirecao": 0,
            "ultimaMensagemStatus": 3,
            "created": "2026-04-06T13:36:20.448Z",
            "totalMessages": 2,
            "mensagens": [
                {
                    "id": "69d3b6feb854f9f1523854a9",
                    "texto": "Ok, obrigada",
                    "audioTranscribeStatus": 0,
                    "contactCards": [],
                    "ackStatus": 0,
                    "dataEnvio": "2026-04-06T13:37:02.61Z",
                    "dataRecebimento": "2026-04-06T13:37:02.61Z",
                    "direcao": 0,
                    "editedMessage": false,
                    "forward": false,
                    "idExterno": "AC055EFCF93306FA0606EF3FDA6A7DFD",
                    "messageType": 0,
                    "mensagemPersonalizadaId": 0,
                    "atendimentoId": "69d3b6d4a33b5d339bdf69a5",
                    "departamentoId": "5f3eb6eac8691640b84b6f5e",
                    "canalId": "614bcca35a328d0a32375f13",
                    "chatId": "000000000000000000000000",
                    "chatMessageId": "000000000000000000000000",
                    "created": "2026-04-06T13:37:02.61Z",
                    "deleted": false,
                    "isStatus": false,
                    "orderItemCount": 0
                },
                {
                    "id": "69d3b6d4a33b5d339bdf69a7",
                    "texto": "Oi Malu, é a Bruna do iHelp! Sua reunião com nossa especialista foi agendada:✅\n\nData: | 07/04/2026 - Terça-Feira\nHorário: 16:00 (de Brasília)\n\nSala:\nhttps://meet.google.com/bud-zncg-wbb\nEspecialista: Bruno Barbosa",
                    "audioTranscribeStatus": 0,
                    "contactCards": [],
                    "ackStatus": 3,
                    "userName": "Bruna Fernandes",
                    "dataEnvio": "2026-04-06T13:36:20.423Z",
                    "dataRecebimento": "0001-01-01T00:00:00Z",
                    "direcao": 1,
                    "editedMessage": false,
                    "forward": false,
                    "idExterno": "3EB011B8EA61E013CCBFF7",
                    "messageType": 0,
                    "mensagemPersonalizadaId": 0,
                    "atendimentoId": "69d3b6d4a33b5d339bdf69a5",
                    "departamentoId": "5f3eb6eac8691640b84b6f5e",
                    "canalId": "614bcca35a328d0a32375f13",
                    "chatId": "000000000000000000000000",
                    "chatMessageId": "000000000000000000000000",
                    "created": "2026-04-06T13:36:20.423Z",
                    "deleted": false,
                    "isStatus": false,
                    "orderItemCount": 0
                }
            ],
            "suggestedResponse": "Por nada, Malu! Qualquer dúvida ou se precisar remarcar, estou à disposição. Até a reunião!"
        }
    }
}
```

------
