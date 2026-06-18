---
title: "Mensagem comum"
sidebar_position: 1
---

:::tip[Compatibilidade]
Compatível com API oficial e não oficial.
:::

### `POST`
```http
https://apiv3.ihelpchat.com/api/v2/customers/send-message
```

**Body (JSON):**
```json
{
    "texto": "Mensagem",
    "canalId": "69bd5219d057b663d5476f5d",
    "contato": "551788889999",
    "messageType": 0
}
```
:::info[Observação]
`messageType: 0` = texto
:::
