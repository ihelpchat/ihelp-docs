# MCP de documentação

O servidor permite que uma IA consulte a base, valide conteúdo e envie um FAQ/tutorial como draft ou pull request. Ele nunca faz merge ou deploy.

## Ferramentas

- `docs_inventory`: mostra módulos cobertos e gaps.
- `docs_search`: evita duplicação de conteúdo.
- `docs_get_article`: entrega o artigo completo para revisão ou reaproveitamento.
- `docs_audit_content`: verifica toda a base contra o padrão editorial.
- `docs_validate_article`: valida schema, caminhos, Tango e possíveis segredos.
- `docs_submit_article`: cria draft local ou pull request e exige `requestedBy`.
- `docs_product_context`: consulta frontend e backend no GitHub, além de sinais agregados de suporte e cobertura editorial.
- `docs_plan_content` e `docs_generate_package`: planejam e geram FAQ, tutorial e ações guiadas sem vídeo.
- `docs_submit_package`: aceita `articles` para create/update e `deletes` para remoção, com `mode: dry_run | draft | pull_request`; na PR atualiza MDX e os `meta.json` afetados.
- `docs_update_article` e `docs_delete_article`: atualizam ou removem por PR revisável.

## Migração dos clientes de escrita

Todo cliente que chama ferramentas de IA ou escrita deve enviar `requestedBy` antes de atualizar o servidor. Use somente um identificador opaco e não sensível no formato `user:<id>` ou `service:<id>` (3 a 64 caracteres minúsculos, dígitos, `_` ou `-` após o prefixo), por exemplo `service:docs-bot`. Nunca use nome, email, token ou outro dado pessoal. Chamadas sem o campo ou com valor inválido são rejeitadas; `docs_inventory`, `docs_search`, `docs_get_article`, `docs_audit_content` e `docs_validate_article` continuam sem ator.

Exemplo seguro de argumentos para escrita (junto dos demais campos obrigatórios do artigo):

```json
{"mode":"draft","requestedBy":"service:docs-bot"}
```

## Audit log local

O servidor grava JSONL append-only em `<DOCS_ROOT>/.audit/docs-submissions.jsonl` (`pilot/.audit/` por padrão), fora do Git. O diretório exige permissão `0700` e o arquivo `0600`; se não puder gravar a tentativa, a escrita não começa. Cada tentativa com ator validado gera eventos `attempt` e `success` ou `failure`, com data UTC (`at`), `actor`, `operation`, `mode`, `target` e `result`. Um caminho inválido aparece como `target: null`. O log nunca inclui body, prompt, token, IP, detalhe de erro ou campos livres do artigo. Chamadas rejeitadas pelo schema antes do handler (inclusive sem ator) não chegam ao log.

Antes do POST que cria uma PR, o log grava `external_request` com a branch de correlação. A descrição da própria PR recebe ator opaco, data UTC, operação e alvo: se o audit local ficar indisponível após a criação, o erro devolve a URL da PR criada, e a PR preserva a evidência do resultado externo. O evento prévio não significa sucesso. Drafts são criados somente em diretórios reais sob `.drafts`, sem symlink ou diretório gravável por grupo/outros, e com arquivo exclusivo `0600`.

Retenção operacional: manter os eventos por 90 dias; o operador deve rotacionar/arquivar o arquivo e eliminar cópias vencidas segundo a política interna. Não há limpeza automática. Proteja também os arquivos arquivados com acesso restrito.

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

Antes de revisar um conteúdo, a IA deve buscar duplicidades com `docs_search`, carregar a versão integral com `docs_get_article`, validar o resultado e enviá-lo como draft ou pull request. `npm run content:audit` aplica as mesmas regras à base completa; `npm run content:migrate` importa o legado e já executa a normalização editorial.

Em produção, a próxima evolução do MCP é trocar a chave compartilhada por OAuth e identidade por usuário.
