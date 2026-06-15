---
title: "Pegar IDs: Departamento e Canal"
sidebar_position: 7
---

Endpoints 
GET
```http
https://apiv3.ihelpchat.com/api/v2/configurations/departments
```
```http
https://apiv3.ihelpchat.com/api/v2/configurations/channels
```

### Buscar Cliente por Telefone
GET
```http
https://apiv3.ihelpchat.com/api/v2/customers/search?searchText=<telefone>&quantidade=20&skip=0
```

**Exemplo:**
GET
```http
https://apiv3.ihelpchat.com/api/v2/customers/search?searchText=5517936189969&quantidade=20&skip=0
```

### Response (Extrair IDs)
```json
{
    "dados": [
        {
            "id": 20453841,
            "ativo": true,
            "canalId": 1,              
            "departamentoId": 5,     
            "chatId": "69bd3b984b63b6add44df458",
            "contato": {
                "id": 4752052,
                "nome": "Gian - Vaga Automação"
            }
            // ... demais campos
        }
    ]
}
```

----
