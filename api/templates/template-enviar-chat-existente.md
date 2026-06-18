---
title: "Enviar em chat existente"
sidebar_position: 3
---

:::info[Compatibilidade]
API iHelp — Body compatível com conta conectada na Gupshup.
:::

 `POST`
```http
https://apiv3.ihelpchat.com/api/v2/customers/send-template
```

:::info[Observação]
Informe o `atendimentoId` do atendimento em que o template será enviado. Para **iniciar um novo atendimento**, use [Criar novo chat](./template-criar-novo-chat.md) (`add-new-call`).
:::

### Com Botões
```json
{
    "contactList": ["551788889999"],
    "departamentoId": 6668,
    "canalId": 8181, 
    "mensagemInicial": {
        "texto": "Oi Nome da pessoa, tudo bem? Só confirmando: você vai conseguir participar da nossa reunião online hoje às 15? Me responde aqui com um 'sim' pra eu garantir seu lugar! | [Sim] | [Reagendar]",
        "tipoMensagem": 9,
        "cloudApiTemplateName": "b0x0x0xee-f546-4519-abb7-40x0x0x0b",
        "params": ["Nome da pessoa", "15"]
    },
    "nome": null,
    "atendimentoId": "69b44de8975fa5e96de10bc6"
}
```

### Sem Botões
```json
{
    "contactList": ["551788889999"],
    "departamentoId": 6668,
    "canalId": 8181, 
    "mensagemInicial": {
        "texto": "Oi Nome da pessoa, tudo bem? Só confirmando: você vai conseguir participar da nossa reunião online hoje às 15? Me responde aqui com um 'sim' pra eu garantir seu lugar!",
        "tipoMensagem": 9,
        "cloudApiTemplateName": "b0x0x0xee-f546-4519-abb7-40x0x0x0b",
        "params": ["Nome da pessoa", "15"]
    },
    "nome": null,
    "atendimentoId": null
}
```

---
