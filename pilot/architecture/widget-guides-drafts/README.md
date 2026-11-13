# Roteiros v2 para o redesign de configurações

Três propostas source-only, fora do catálogo publicado, conferidas com os controles e as rotas de `ihelp-react@3d00906c5315c91372914e0ea664a59372dfc10b` (`release/pre-production`, 12/11/2026). A primeira versão foi escrita sobre `integration/grupos-redesign@730ec0c95`; a release mudou o modal de conexão por QR (escolha de histórico antes do código e passos por Android/iPhone), e o roteiro de reconexão foi ajustado a ela. Não são aprovação editorial nem prova de jornada real. Não foi feita geração de IA, captura de tela, criação de usuário, conexão de WhatsApp, envio ou alteração em cliente.

| Arquivo / guideId | Versão | Primeiro passo | Mudança de fluxo |
| --- | --- | --- | --- |
| `recado-fora-do-horario.json` | 2 / treino | `abrir-horarios` | Horário em **Horários e feriados**; texto por departamento em **Mensagens automáticas → Fora de horário**. O cartão do departamento é leitura. |
| `usuario-acesso.json` | 2 / treino | `abrir-usuarios` | **Novo usuário** leva a `/configuracoes/usuarios/novo`; a criação usa senha e perfis disponíveis, sem prometer convite por e-mail. |
| `reconectar-canal-qr.json` | 2 / treino | `abrir-canais` | Reconexão do canal existente em `/configuracoes/canais/:idRef`; o botão da lista pede canal novo e API Oficial segue outro fluxo. Depois de **Conectar**, o modal pode pedir a escolha de histórico antes de **Gerar QR Code**. |

## Revisão editorial (13/11/2026)

Feita a pedido do Bruno, com os nomes de botões, cartões e avisos conferidos no código das telas em `release/pre-production@712e50c34` (as telas referenciadas não mudaram desde `3d00906c5`). Régua: rubrica do FAQ no propósito passo a passo (tarefas completas, clareza, coerência) e as regras do dono L001–L009 de `faq-regua/guia-aprendido.json`. Mudou só o texto dos passos e a descrição de cada roteiro; IDs, títulos, escolhas, grafo, navegação e evidências ficaram iguais.

- Saíram do texto para o cliente as notas internas e de ensaio (L001, L003, L009): "a criação atual não promete convite", "não comprova isolamento", "não conclua o roteiro como resolvido", "não tente adivinhar prazo", "não altere outro departamento para testar".
- Bloqueio diz o motivo e a saída que a tela oferece (L008): só administradores criam usuários, limite do plano, API Oficial, sem o celular.
- Ação diz o efeito quando ele decide o próximo passo (L005): departamentos limitam as conversas que a pessoa vê, o padrão vale para a empresa toda, texto em branco não envia recado, feriado com mensagem própria prevalece, o progresso fica guardado na pausa.
- Os três roteiros terminam em resultado que a pessoa vê (L002): acesso conferido por quem entrou, texto e horário reabertos, canal em Conectado.

`publication.editorialApproved` continua `false`: a aprovação do texto é do responsável editorial (`faq-regua/responsaveis.md`), e a jornada real em conta autorizada continua pendente.

## Consumo local

Cada envelope contém `guide` validável pelo `guideSchema` existente, `titlesByStep` (título curto de cada passo para o cartão do guia; texto novo, também sujeito à revisão editorial), `navigationByStep`, `transitionsByStep`, pré-requisitos e QA pendente. Os IDs antigos foram preservados e a versão subiu porque mudou o procedimento. `mode: treino` identifica o piloto; não concede autorização para executar ações reais. `publication` permanece false em todos os campos.

O piloto deve consumir **o envelope inteiro**, seguindo `transitionsByStep`: `continue` avança para `nextStepId`, `choices` exige uma escolha explícita, e `outcome` encerra em `complete`, `handoff` ou `paused`. Só a declaração da pessoa confirma a conclusão; navegar, achar um botão, renderizar um modal ou chegar a um passo não confirma salvamento/conexão/acesso. `handoff` e `paused` nunca viram sucesso.

**Não passar só `guide.steps` para o engine publicado.** `mcp/guide-state.mjs` infere alguns próximos passos pela posição do array e não conhece navegação local nem os três outcomes deste envelope. O grafo explícito evita depender dessa inferência. `publishedEngineCompatible: false` registra a limitação; adaptar/validar o consumo é etapa separada. `guideSchema` sozinho valida formato, não execução. Os drafts v2 também não devem ser enviados ao `/assistant` com o estado v1 publicado.

`navigationByStep` contém rotas canônicas e descritores de controles observados no source. Não contém selectors de captura nem IDs de clientes. `routeTemplate` é só documentação: requer seleção explícita do canal atual pelo usuário; nunca interpolar um ID de outro contexto. Navegação local continua sujeita aos gates reais do iHelp. Nenhuma dessas referências executa `click`, `submit`, conexão ou envio. Os dois `actionId` existentes mantêm compatibilidade com o catálogo legado; novas rotas não inventam IDs de ProductAction.

`evidenceByStep` referencia arquivo, linha e fragmento no SHA fixado. Prova presença do controle e vínculo com o source, não resultado em runtime. `editorialSteps` identifica orientação de segurança, pausa, conferência ou atendimento escrita para o roteiro; suas referências delimitam a operação e não comprovam um botão de atendimento no produto. Nomes de menus do WhatsApp foram transcritos do modal do iHelp; Android/iPhone precisam de confirmação na jornada autorizada.

Para validar estrutura, grafo, referências no SHA exato e preservação do pacote público, execute o fixture de desenvolvimento pela fila global com:

```sh
node pilot/architecture/widget-guides-drafts/validate.mjs /caminho/para/ihelp-react
node pilot/scripts/generate-guide-package.mjs --check
```

O validator só lê JSON e blobs de Git locais. Não acessa rede, conta ou provider de IA. A validação source-only não substitui QA editorial nem prova de persistência, isolamento ou conexão.

## Piloto no iHelp

O front (`ihelp-react`, `src/features/help-assistant/task-guides.drafts.json`) carrega uma cópia compacta destes envelopes, gerada por `scripts/help-assistant-drafts.mjs` com o SHA deste repositório, e executa o grafo inteiro: `continue`, `choices` e os três outcomes. O piloto só aparece para as empresas listadas em `ASSISTANT_WIDGET_PILOT_COMPANY_IDS`, com os IDs em `ASSISTANT_WIDGET_PILOT_GUIDES` (`GET /assistant/config`, ver `mcp/README.md`). Sem essas duas variáveis ninguém vê os roteiros; não existe configuração que os libere para todas as empresas. Ligar o piloto para uma empresa interna serve à revisão editorial e à jornada autorizada; não é publicação nem aprovação.

O piloto não envia estes roteiros ao `/assistant` como guias publicados e não marca `publication`. A conclusão só acontece pela declaração da pessoa no último passo.

## Condição de publicação

1. Revisar o texto com o responsável editorial e concluir `runtimeQaPending` em jornada explicitamente autorizada, com contas/canais reservados e cleanup. Criar usuário, trocar perfil, conectar e enviar mensagem têm efeitos reais; esta preparação não os executa nem renova aprovação para executá-los.
2. Resolver o consumo do grafo no runtime escolhido e testar avanço, voltar, branch, pausa, handoff, falha e mudança de versão. Conferir permissões, menus e reabertura dos valores; a conta de teste da pessoa precisa verificar o acesso esperado.
3. Só então portar o roteiro aos MDX canônicos, atualizar referências no SHA revisto e solicitar a nova aprovação das frases em `content/canonical-guides.approved.json`. `approve-canonical-guides.mjs` apenas prepara o ledger com aprovação pendente; não representa aprovação humana nem deve ser usado para contornar o gate. O gate de jornada continua aplicável.
4. Depois da aprovação e dos checks, gerar um novo pacote imutável em `public/guides` pelo fluxo existente. Não sobrescrever versões antigas. Publicação/deploy ficam fora desta preparação.

Os três MDX de produção, o ledger de aprovação e `public/guides` permanecem inalterados. Os loaders atuais leem `content/docs`; este diretório em `architecture` não entra na recuperação, triagem ou catálogo público.
