---
title: "Criar novo chat"
sidebar_position: 4
---

:::info[Compatibilidade]
API iHelp — Body compatível com conta conectada na Gupshup.
:::

 `POST`
```http
https://apiv3.ihelpchat.com/api/v2/customers/add-new-call
```

### Com Botões
```json
{
    "contactList": ["5588882222"],
    "departamentoId": 6668,
    "canalId": 8181,
    "mensagemInicial": {
        "texto": "Oi Gian, tudo bem? Só confirmando: você vai conseguir participar da nossa reunião online hoje às 10? Me responde aqui com um 'sim' pra eu garantir seu lugar! | [Sim] | [Reagendar]",
        "tipoMensagem": 9,
        "cloudApiTemplateName": "bx0x0x0e-f546-4519-abb7-4x0x0x0x0x0xb",
        "params": ["Gian", "10"]
    },
    "nome": null,
    "atendimentoId": null
}
```

### Botão de Link Dinâmico
```json
{
    "contactList": ["5588882222"],
    "departamentoId": 6668,
    "canalId": 8181,
    "mensagemInicial": {
       "texto": "⚠️ INFORMACAO DE VIAGEM\n\n__var1__\n\nPontos da Rota:\n__var2__\n\nRota: __var3__\n\n---\nNotificacao automatica TechnocelGR Para maiores informacoes entre em contato com nossa central (17) 3334-7850\n\n[VALIDACAO] Enviado para: __var4__ OK | [Navegação]",
        "tipoMensagem": 9,
        "cloudApiTemplateName": "a86fd979-dc78-4f34-8931-fdb73f953cab",
        "params": [
            "__var1__",
            "__var2__",
            "__var3__",
            "__var4__",
            "https://maps.google.com/wwwwww  "
        ]
    },
    "nome": null,
    "atendimentoId": null
}
```

### Mensagem de texto com params

```json
{
    "contactList": ["5588882222"],
    "departamentoId": 6668,
    "canalId": 8181,
    "mensagemInicial": {
        "texto": "Oi Gian, tudo bem? Só confirmando: você vai conseguir participar da nossa reunião online hoje às 10? Me responde aqui com um 'sim' pra eu garantir seu lugar!",
        "tipoMensagem": 9,
        "cloudApiTemplateName": "bx0x0x0e-f546-4519-abb7-4x0x0x0x0x0xb",
        "params": ["Gian", "10"]
    },
    "nome": null,
    "atendimentoId": null
}
```
### Mensagem de texto sem params

```json
{
    "contactList":["5517936189969"],
    "departamentoId":10,
    "canalId":1,
    "mensagemInicial":
        {
        "texto":"Olá, estou iniciando seu atendimento no ihelp",
        "tipoMensagem":9,
        "cloudApiTemplateName":"new_call"
        },
    "nome":null,
    "atendimentoId":null
}
```

---

:::warning[Atenção]
- 📞 Números devem estar no formato E.164: `55DD9XXXXXXXX`
- 🔗 Links só funcionam em botões do tipo **URL Button**
- 🧪 Sempre teste templates no **Meta Template Manager** antes de usar em produção
:::

---

*Documentação atualizada: 2026-05-15 13:38*
