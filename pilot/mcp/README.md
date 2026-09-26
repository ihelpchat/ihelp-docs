# MCP de documentação

## Dados da Claricia

O `/assistant` remove padrões conhecidos de credenciais, email, CPF e telefone da pergunta e do histórico antes da chamada ao provider. A redaction não detecta nomes nem endereços e não é anonimização total. O `/feedback` guarda voto e caminhos, sem pergunta ou user agent. Caminhos com query ou fragmento são rejeitados.

Eventos de sessão em `SESSION_EVENTS_FILE` (padrão `/tmp/ihelp-docs-session-events.jsonl`) guardam somente `sessionId` opaco, origem (`faq` ou `app`), guia, passo, duração, resultado, caminho local e horário. IDs de sessão e feedback recebidos pelo HTTP são HMAC-SHA256 com `LOG_ID_KEY` e ficam como prefixo do tipo mais 16 hex. Sem `LOG_ID_KEY`, a chave aleatória é gerada ao subir o processo: a correlação nos registros vale só enquanto ele vive; para juntar dias diferentes, Bruno define `LOG_ID_KEY` no Railway. O schema rejeita campos extras e URL com query. `pruneSessionEvents` elimina registros com mais de 30 dias; o serviço chama essa limpeza no primeiro pedido e pelo menos uma vez a cada 24 horas enquanto recebe pedidos. `discardSessionEvents` remove todos os eventos de um `sessionId` opaco solicitado pelo operador. O arquivo padrão em `/tmp` não é persistente entre deploys.

O servidor permite que uma IA consulte a base, valide conteúdo e envie um FAQ/tutorial como draft ou pull request. Ele nunca faz merge ou deploy.

Para gerar conteúdo com grounding de código, configure `PRODUCT_LOCAL_CHECKOUT` e `BACKEND_LOCAL_CHECKOUT` no servidor. O chamador escolhe somente `frontend` ou `backend`; o SHA vem do Git do checkout e não do pedido. A busca lê código fonte rastreado, rejeita symlinks em qualquer componente do caminho e pastas operacionais, limita arquivos, bytes e tempo, e devolve caminho, linha e SHA. Checkout ausente ou alterado mantém plano e pacote em `needs_information`; resposta sem citações verificáveis fica em `needs_evidence`.

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

### Decisões por padrão: IP usado nos limites

`TRUSTED_IP_SOURCE` aceita `x-real-ip`, `xff-hops` ou `socket`. Em `RAILWAY_ENVIRONMENT_NAME=production`, o padrão é `x-real-ip`, conforme o header de cliente documentado pelo Railway. Fora desse ambiente, o padrão mantém `xff-hops`; `TRUST_PROXY_HOPS` (1 por padrão) escolhe o salto contado da direita. `socket` ignora headers de IP. Valor ausente ou inválido na fonte escolhida usa o endereço do socket. Configure `TRUSTED_IP_SOURCE=socket` quando o serviço for acessado diretamente, sem proxy confiável. **`x-real-ip` e `xff-hops` só são seguros atrás de um proxy que sobrescreva o header escolhido**; se o cliente puder fornecê-lo, poderá trocar o IP usado na cota.

Antes de produção, confira em staging que o tráfego público passa pelo proxy esperado e que ele **sobrescreve** `X-Real-IP` ou `X-Forwarded-For` (conforme o modo), inclusive quando o cliente envia um valor forjado. Envie 10 perguntas com o mesmo `sessionId` a partir de cada uma de duas redes distintas: a 11ª de cada rede deve receber 429 com `Retry-After` próximo do tempo restante da janela, enquanto uma sessão nova da outra rede ainda recebe 200. Confira no DevTools do FAQ em origem diferente que `Retry-After` está disponível para o JavaScript. Se a topologia não garantir a sobrescrita do header escolhido, use `socket` ou ajuste o proxy e repita a prova antes de publicar. Esta conferência de staging/deploy fica com o Bruno.

### Contexto opcional do widget

`POST /assistant` aceita `widgetContext` além de `question`, `history`, `scope` e `page`. Clientes antigos podem omiti-lo. Exemplo:

```json
{"question":"como criar um chatbot?","widgetContext":{"surface":"app","route":"/bot","module":"robots","screen":"list","role":"agent","permissions":["robots.read"],"plan":"trial","channels":[{"kind":"whatsapp","state":"connected"}],"credit":"available","templates":"none","incidents":[]}}
```

O contrato usa somente enums em `mcp/real-state.mjs`: `surface` (`faq`, `app`), `module`, `screen`, `role`, `permissions`, `plan`, `channels` (`kind`, `state`), `credit`, `templates` e `incidents`. `route` aceita apenas rotas do catálogo de ProductActions. Campos desconhecidos, texto livre, URL com query, telefone, identificadores e tokens invalidam o contexto inteiro; ele é ignorado, e a pergunta continua funcionando. Há limites de 1.500 caracteres serializados, 12 permissões, 5 canais e 5 incidentes. O contexto é uma indicação read-only fornecida pelo cliente, sem autoridade para liberar ações ou confirmar estado de backend.

A resposta inclui `diagnosis.cause` e, após tentativa guiada sem resolução, `escalation` com `intent`, `diagnosis`, `state` validado e `attempts` em enums. A interface monta o CTA de atendimento com esses campos, sem copiar a pergunta ou o histórico. A integração no widget do iHelp deve enviar apenas os estados já presentes na UI; esta entrega não altera o widget.
O estado enviado pelo cliente serve apenas como hint relacionado à intenção: não suprime passos, screenshots, fontes ou ProductActions autorizadas e não comprova plano, permissão ou incidente. Apenas uma ação do usuário ou confirmação por fonte confiável poderia justificar um bloqueio futuro.

Antes de revisar um conteúdo, a IA deve buscar duplicidades com `docs_search`, carregar a versão integral com `docs_get_article`, validar o resultado e enviá-lo como draft ou pull request. `npm run content:audit` aplica as mesmas regras à base completa; `npm run content:migrate` importa o legado e já executa a normalização editorial.

Em produção, a próxima evolução do MCP é trocar a chave compartilhada por OAuth e identidade por usuário.
