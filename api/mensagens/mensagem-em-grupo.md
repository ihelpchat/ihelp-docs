---
title: "Mensagem em grupo"
sidebar_position: 2
---

**POST**
```http
https://apiv3.ihelpchat.com/api/v2/Groups/sendGroupMessage
```

**FORM DATA**:

**KEY**: ``groupId``
**VALOR**: ``<ID DO GRUPO>``

**KEY**: ``mensagem``
**VALOR**: 
```
{"texto":"aaaaaaaaaaa\n","canalId":"66da164b9a7a7e3f33969195","contato":"5517996573343","messageType":0}
```

- **texto**: sua mensagem
- **canalId**: id do canal WhatsApp que enviará a mensagem
- **contato**: número de telefone que está enviando a mensagem
- **messageType**: `0` = texto

**groupId** — deve ser pego na página do grupo:

1. Abra o grupo no iHelp
2. **Aperte F12** no navegador
3. Envie uma mensagem
4. Copie o `groupId` do iHelp

![](/img/api/zen_Lr5FVdcZNv.png)

**Exemplo de campos Form Data no request POST:**

![](/img/api/Pasted%20image%2020260424125712.png)

----

**Response ex:**
```
{"dados":{"id":"3EB0FDFB21D798F622E515","type":0,"content":"aaaaaaaaaaa\n","groupId":27394,"waId":"120363400348108702","canalIdRef":"66da164b9a7a7e3f33969195","messageTimestamp":"2026-04-24T15:40:32","fromMe":true,"pushName":"Gian","messageType":0,"deleted":false}}
```

raw request

```json
------geckoformboundary32eb059677e9a8526544f1210a8f3230
Content-Disposition: form-data; name="groupId"

19025
------geckoformboundary32eb059677e9a8526544f1210a8f3230
Content-Disposition: form-data; name="mensagem"

{"texto":".","canalId":"614bcca35a328d0a32375f13","contato":"5517992610896","messageType":0}
------geckoformboundary32eb059677e9a8526544f1210a8f3230--

```

---
