---
title: "Enviar mídia"
sidebar_position: 3
---

:::tip[Compatibilidade]
Compatível com API oficial e não oficial.
:::

Há duas formas de enviar mídia (imagem, vídeo, áudio ou documento):

- **Por link** - a mídia já está em uma URL pública e o iHelp a busca pela URL. Usa o mesmo endpoint da [Mensagem comum](./mensagem-comum.md) (`send-message`), sem subir bytes.
- **Binário** - você tem o arquivo em mãos e sobe os bytes via `multipart/form-data` (`upload-files`). O iHelp armazena o arquivo e infere o tipo pelo MIME.

## Enviar mídia por link

Mesmo endpoint da mensagem comum, trocando o `messageType` e adicionando `mediaUrl`.

### `POST`
```http
https://apiv3.ihelpchat.com/api/v2/customers/send-message
```

**Body (JSON):**
```json
{
    "canalId": "69bd5219d057b663d5476f5d",
    "contato": "551788889999",
    "messageType": 1,
    "mediaUrl": "https://images.ihelpchat.com/medias/foto.jpg",
    "tipoMensagem": "image/jpeg",
    "caption": "Confira nossa promoção"
}
```

| Tipo | `messageType` | Exemplos de `tipoMensagem` (MIME) |
| --------- | ------------- | ------------------------------------- |
| Imagem | `1` | `image/jpeg`, `image/png` |
| Vídeo | `2` | `video/mp4` |
| Áudio | `4` | `audio/ogg`, `audio/mpeg` |
| Documento | `5` | `application/pdf`, `application/msword` |

- **mediaUrl**: URL pública do arquivo (o iHelp baixa na hora do envio)
- **tipoMensagem**: MIME do arquivo
- **caption**: legenda (opcional)

:::info[Documentos]
Para `messageType: 5` (documento), envie também `fileName` com o nome do arquivo:
```json
{
    "canalId": "69bd5219d057b663d5476f5d",
    "contato": "551788889999",
    "messageType": 5,
    "mediaUrl": "https://images.ihelpchat.com/medias/contrato.pdf",
    "tipoMensagem": "application/pdf",
    "fileName": "contrato.pdf",
    "caption": "Segue o contrato"
}
```
:::

## Enviar mídia binária

Sobe o arquivo via `multipart/form-data`. O `messageType` **não** é enviado: o iHelp infere o tipo pelo `Content-Type` do arquivo.

### `POST`
```http
https://apiv3.ihelpchat.com/api/v2/customers/upload-files/{IdRef}/{caption?}
```

- **IdRef** (rota): IdRef do atendimento (conversa) que receberá a mídia
- **caption** (rota, opcional): legenda da mídia
- **targetUserId** (query, obrigatório): ID numérico do usuário/atendente do envio
- **skipLastAgentMessageTimeUpdate** (query, recomendado `true`): evita reiniciar a janela de inatividade do atendimento a cada mídia

**Form Data:**

**KEY**: ``myFile``
**VALOR**: ``<arquivo binário>``

**Exemplo (curl):**
```bash
curl -X POST \
  "https://apiv3.ihelpchat.com/api/v2/customers/upload-files/{IdRef}/Segue%20o%20contrato?targetUserId=123&skipLastAgentMessageTimeUpdate=true" \
  -H "Authorization: Bearer <TOKEN>" \
  -F "myFile=@/caminho/contrato.pdf"
```

:::warning[Limites por canal]
Em canais que **não** são Baileys (ex.: API oficial), arquivos acima do limite são reenviados como **documento**:

- Imagem acima de **5 MB**
- Áudio ou vídeo acima de **16 MB**
:::
