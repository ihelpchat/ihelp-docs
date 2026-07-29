---
title: "Funis e etapas"
sidebar_position: 2
---

Comece por aqui. Estes dois endpoints devolvem os IDs de funis e etapas que os endpoints de movimentação exigem.

## Todos os funis

Lista os funis (pipelines) **ativos** da sua empresa. É o ponto de partida: o `id` retornado aqui alimenta a consulta de etapas e todas as chamadas de movimentação.

### `GET`
```http
https://apiv3.ihelpchat.com/api/v2/crm/funnel
```

Sem parâmetros.

**Resposta `200 OK`:**
```json
[
  {
    "id": 12,
    "title": "Funil de Vendas",
    "description": "Pipeline comercial padrão",
    "isDefault": true,
    "isActive": true,
    "contactLock": false,
    "businessId": 3,
    "createdDate": "2026-01-15T13:20:41Z",
    "updatedAt": "2026-07-10T09:02:11Z"
  }
]
```

| Campo | Descrição |
|---|---|
| `id` | ID do funil, use como `funnelId` |
| `title` | Nome exibido |
| `isDefault` | Indica o funil padrão da empresa |
| `isActive` | Sempre `true` nesta listagem |
| `contactLock` | Quando `true`, o mesmo contato não pode ter dois cards ativos neste funil |

:::info[Observação]
O campo `stages` **não** vem preenchido aqui. Para as etapas, use o endpoint abaixo.

O retorno respeita as permissões do usuário dono do token: administradores veem todos os funis da empresa, demais usuários veem apenas aqueles a que têm acesso. Funis excluídos ou inativos não aparecem.
:::

## Todos os estágios do funil

Retorna **um funil junto com todas as suas etapas**, ordenadas por `order`. É daqui que sai o `stageId` usado como destino nas movimentações.

### `GET`
```http
https://apiv3.ihelpchat.com/api/v2/crm/funnel/{id}/with-stages
```

| Param | Tipo | Descrição |
|---|---|---|
| `id` | int | ID do funil (rota) |

**Resposta `200 OK`:**
```json
{
  "id": 12,
  "title": "Funil de Vendas",
  "isDefault": true,
  "isActive": true,
  "contactLock": false,
  "stages": [
    { "id": 101, "title": "Novo lead",    "color": "#4F46E5", "order": 1, "funnelId": 12, "isActive": true },
    { "id": 102, "title": "Qualificação", "color": "#0EA5E9", "order": 2, "funnelId": 12, "isActive": true },
    { "id": 103, "title": "Proposta",     "color": "#F59E0B", "order": 3, "funnelId": 12, "isActive": true }
  ],
  "rules": [],
  "funnelUsers": []
}
```

| Campo de `stages[]` | Descrição |
|---|---|
| `id` | ID da etapa, use como `stageId` / `targetStageId` |
| `title` | Nome da coluna |
| `color` | Cor em hexadecimal |
| `order` | Posição da etapa no funil, em ordem crescente |
| `funnelId` | Funil a que a etapa pertence |
| `isActive` | Ver alerta abaixo |

:::warning[A lista `stages` inclui etapas inativas]
Filtre por `isActive === true` antes de exibir ou usar como destino. Mover para uma etapa inativa retorna `409 stage_inactive`.
:::

O objeto também traz `rules` (regras de automação do funil) e `funnelUsers` (permissões). Ignore se não for utilizá-los.

Para montar o mapa completo de todos os funis e todas as etapas: chame `GET /crm/funnel` e depois este endpoint uma vez por funil retornado.

### Erros

| HTTP | Quando |
|---|---|
| 401 | Token ausente, inválido ou expirado |
| 404 | Funil não existe ou não pertence à sua empresa |
