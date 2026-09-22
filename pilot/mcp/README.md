# MCP de documentação

O servidor permite que uma IA consulte a base, valide conteúdo e envie um FAQ/tutorial como draft ou pull request. Ele nunca faz merge ou deploy.

## Ferramentas

- `docs_inventory`: mostra módulos cobertos e gaps.
- `docs_search`: evita duplicação de conteúdo.
- `docs_validate_article`: valida schema, caminhos, Tango e possíveis segredos.
- `docs_submit_article`: cria draft local ou pull request.

## Execução local

```bash
npm run mcp:start
```

## HTTP remoto

Configure `DOCS_MCP_API_KEY` com ao menos 24 caracteres. Para abrir pull requests, configure também `GITHUB_TOKEN`, `GITHUB_REPOSITORY=ihelpchat/ihelp-docs` e `GITHUB_BASE_BRANCH`.

```bash
DOCS_MCP_API_KEY=... npm run mcp:http
```

O endpoint é `/mcp` e exige `Authorization: Bearer <DOCS_MCP_API_KEY>`. Em produção, a próxima evolução é trocar a chave compartilhada por OAuth e identidade por usuário.
