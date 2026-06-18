---
title: "Buscar chats em massa"
sidebar_position: 4
---

1. Criar um filtro no topo da aba de atendimento: 

![](/img/api/Pasted%20image%2020260409105659.png)
2. Selecione todos os canais da empresa:

![](/img/api/Pasted%20image%2020260409105743.png)

3. Com o canal criado, Aperte **F12** e abra a aba **Network**
4. Clique no filtro para pegarmos o **id do filtro** que retornará todos os chats:

![](/img/api/Pasted%20image%2020260409110021.png)

4. Crie outro filtro e faça o mesmo para buscar **conversas encerradas** (filtros podem buscar apenas 1 status, Aberta ou Encerada):

![](/img/api/Pasted%20image%2020260409110412.png)

5. Com os dois ids de filtro, você já pode buscar e paginar todos os atendimentos com 'skip' e 'limit' - eles são retornados por data de 'ultima mensagem' no chat

:::info[Rate limits]
Para buscar dados massivos, respeite o rate limit de 30 requests por minuto para as requisições.
:::

### Busca: Conversas Abertas

Use o primeiro filtro ID que você criou:

`GET https://apiv3.ihelpchat.com/api/v2/customers/filtered-calls/88888?skip=0&limit=30`

### Busca: Conversas Encerradas

Use o segundo filtro ID que você criou:

`GET https://apiv3.ihelpchat.com/api/v2/customers/filtered-calls/77777?skip=0&limit=30`

6. Os metadados retornados de cada atendimento irão conter a chave **chatId** - Com ela você pode paginar as mensagens do mesmo modo (com skip e limit) - siga as instruções abaixo: **"Buscar histórico de mensagens"**

---
