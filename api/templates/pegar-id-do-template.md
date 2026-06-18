---
title: "Pegar ID do template"
sidebar_position: 2
---

Nos requests da API, o template é identificado pelo campo **`cloudApiTemplateName`**.

O valor que vai nesse campo **depende de qual painel você usa** para gerenciar seus templates: o **painel da Gupshup** ou o **painel da Meta (Gerenciador do WhatsApp)**.

---

## Painel Gupshup

No painel da Gupshup, o `cloudApiTemplateName` é o **ID do template** (um código no formato UUID, ex.: `2267be99-0000-...-9ee22e4841f8`).

**Passo a passo:**

1. Acesse **Your Templates** no painel da Gupshup.
2. Localize o template, clique em **Manage** e escolha a opção **Copy as cURL**.

![Menu do template na Gupshup com a opção Copy as cURL](/img/api/gupshup-copy-curl.webp)

3. No cURL copiado, procure pelo trecho `id%22:%22`. O ID do template é o valor que fica **entre os caracteres `%22`** logo depois de `id`.

![cURL da Gupshup com o ID do template destacado entre os %22](/img/api/gupshup-curl-id.webp)

:::warning[Não inclua os %22]
Os `%22` são apenas as aspas codificadas (`"`) que delimitam o valor. Copie **somente o ID** que está entre eles — sem os `%22`.

```
...template=%7B%22id%22:%222267be99...9ee22e4841f8%22,%22params%22...
                         └──────────── ID do template ────────────┘
```
:::

---

## Painel Meta (Gerenciador do WhatsApp)

No painel da Meta, o `cloudApiTemplateName` é o **próprio nome do template** (ex.: `lembrete_reuniao`, `send_tokenbr`, `new_call`).

**Onde encontrar:**

- Na lista de modelos, o nome está na coluna **Nome do modelo**:

![Lista de modelos no Gerenciador do WhatsApp com os nomes destacados](/img/api/meta-template-lista.webp)

- Ou no topo da página de detalhes do template:

![Detalhe do template no Gerenciador do WhatsApp com o nome destacado](/img/api/meta-template-detalhe.webp)

---

:::tip[Resumo]
- **Gupshup** → `cloudApiTemplateName` = **ID** (UUID) do template
- **Meta** → `cloudApiTemplateName` = **nome** do template
:::
