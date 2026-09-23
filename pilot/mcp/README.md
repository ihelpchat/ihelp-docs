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

## HTTP remoto e assistente GPT

Configure `DOCS_MCP_API_KEY` com ao menos 24 caracteres. Para abrir pull requests, configure também `GITHUB_TOKEN`, `GITHUB_REPOSITORY=ihelpchat/ihelp-docs` e `GITHUB_BASE_BRANCH`. Para ativar o assistente, configure `OPENAI_API_KEY`; o modelo padrão é `gpt-6-luna` e pode ser trocado por `OPENAI_MODEL`.

```bash
DOCS_MCP_API_KEY=... OPENAI_API_KEY=... ASSISTANT_ALLOWED_ORIGINS=https://docs.exemplo.com npm run mcp:http
```

O endpoint `/mcp` exige `Authorization: Bearer <DOCS_MCP_API_KEY>`. O endpoint público `/assistant` aceita somente perguntas curtas, aplica rate limit, envia apenas trechos recuperados da documentação e chama a OpenAI com `store: false`. A chave permanece exclusivamente no servidor.

Em produção, a próxima evolução do MCP é trocar a chave compartilhada por OAuth e identidade por usuário.
