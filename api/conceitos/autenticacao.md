---
title: "Autenticação"
sidebar_position: 1
---

Todas as requisições devem incluir uma credencial de integração emitida para uso no servidor.

| Header | Valor |
|--------|-------|
| `Authorization` | `Bearer <SUA_CREDENCIAL>` |

**Exemplo seguro:**

```http
Authorization: Bearer <SUA_CREDENCIAL>
```

Nunca publique a credencial na documentação, no frontend ou em capturas de tela. Em produção, carregue-a por uma variável de ambiente ou secret manager.
