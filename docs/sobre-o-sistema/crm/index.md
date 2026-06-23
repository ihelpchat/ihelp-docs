---
title: "CRM"
---

<VideoEmbed url="https://www.tella.tv/video/vid_cmpfkoxim00cf0bj4cwqncb5y/view" />

## FAQ — CRM iHelp: Pipeline

---

### 📋 Índice

1. [Pipelines — Visão Geral](#1-pipelines--visão-geral)
2. [Criar e Configurar uma Pipeline](#2-criar-e-configurar-uma-pipeline)
3. [Estágios da Pipeline](#3-estágios-da-pipeline)
4. [Automações](#4-automações)
5. [Cards — Criação](#5-cards--criação)
6. [Cards — Detalhes e Gestão](#6-cards--detalhes-e-gestão)
7. [Filtros e Views](#7-filtros-e-views)
8. [Tarefas e Notas](#8-tarefas-e-notas)
9. [Campos Obrigatórios e Tarefas Padrão](#9-campos-obrigatórios-e-tarefas-padrão)
10. [Gerenciar Pipelines](#10-gerenciar-pipelines)
11. [Permissões de Acesso](#11-permissões-de-acesso)

---

### 1. Pipelines — Visão Geral

**Como faço para trocar de pipeline rapidamente?**

Use o seletor de pipelines no canto superior da tela. Ele permite navegar entre suas pipelines de forma dinâmica.

:::tip
Você pode favoritar uma pipeline para que ela apareça sempre no topo do seletor.
:::

---

**O valor total da pipeline é calculado automaticamente?**

Sim. O seletor já exibe o valor total de cada pipeline — que é a soma de todos os valores atribuídos aos cards dentro dela.

---

### 2. Criar e Configurar uma Pipeline

**Quais campos preciso preencher ao criar uma pipeline?**

| Campo | O que é |
|---|---|
| Nome | Identificação da pipeline |
| Responsável | Usuário dono da pipeline |
| Descrição | Processo que a pipeline vai gerenciar |
| Ícone | Símbolo visual da pipeline |
| Visibilidade | Quem pode ver a pipeline |
| Meta total | Valor alvo a atingir no período |
| Meta de conversão | Percentual de conversão esperado |

---

**Quais são as opções de visibilidade?**

- **Pública** — todos os usuários do iHelp visualizam
- **Departamento** — apenas usuários do seu departamento
- **Privada** — somente você e pessoas convidadas

---

**O que é a regra de contato duplicado?**

Quando ativada, impede a criação de dois cards com o mesmo contato na mesma pipeline.

:::warning
Se essa regra estiver ativa e você tentar criar um card com um contato já existente, o sistema vai bloquear a criação.
:::

---

**Quais templates de estágio estão disponíveis na criação?**

- **Em branco** — você monta do zero
- **Vendas padrão**
- **SDR / Prospecção** — 5 estágios pré-definidos: Novo Lead, Sem Contato, Tentativa de Contato, Qualificado, Run-off Vendas
- **Suporte**

:::tip
Você pode renomear qualquer estágio do template — a partir disso, ele se torna um estágio personalizado.
:::

---

### 3. Estágios da Pipeline

**Como altero os estágios de uma pipeline existente?**

1. Acesse **Gerenciar Pipelines**
2. Clique em **Configurar Estágios** (primeiro botão)
3. Edite nome, cor e percentual de conversão de cada estágio

---

**O que é o percentual de conversão de um estágio?**

É a probabilidade estimada de fechar um negócio quando o card está naquele estágio.

Exemplo: se você define 50% no estágio "Proposta Enviada", significa que metade dos cards que chegam ali tendem a fechar.

---

**Posso reordenar os estágios?**

Sim. Em **Configurar Estágios**, clique em **Reordenar e Adicionar** para arrastar os estágios na ordem que preferir.

---

**O que acontece com os cards quando excluo um estágio?**

Todos os cards daquele estágio são automaticamente movidos para o primeiro estágio da pipeline.

:::warning
A exclusão é imediata após confirmação. Verifique os cards antes de excluir.
:::

---

### 4. Automações

**Para que servem as automações?**

As automações criam cards automaticamente na pipeline a partir de gatilhos definidos por você — sem precisar criar manualmente.

---

**Quais gatilhos posso usar?**

- Novo atendimento — quando um usuário abre um atendimento
- Atendimento transferido
- Atendimento encerrado

---

**Como configuro uma automação?**

1. Na criação da pipeline, acesse a aba de **Automações**
2. Defina o gatilho (ex: novo atendimento)
3. Defina a condição (ex: usuário é igual a [nome])
4. Defina a ação (ex: criar novo card no estágio X)
5. Nomeie a automação para identificá-la depois

:::tip
Você pode ter várias automações e ativar ou desativar cada uma individualmente.
:::

---

### 5. Cards — Criação

**Qual a diferença entre Novo Card Rápido e Novo Card Completo?**

| | Card Rápido | Card Completo |
|---|---|---|
| Título | ✅ | ✅ |
| Estágio inicial | ✅ | ✅ |
| Contato | ✅ | ✅ |
| Responsável | ✅ | ✅ |
| Valor previsto | ❌ | ✅ |
| Previsão de fechamento | ❌ | ✅ |
| Origem, temperatura, prioridade | ❌ | ✅ |
| Tags | ❌ | ✅ |
| Descrição | ❌ | ✅ |

---

**Posso criar um card sem ter o contato já cadastrado?**

Sim. Na criação do card, digite o número de telefone e clique em **Criar novo contato** — o contato será criado ali mesmo, sem precisar acessar a tela de contatos.

---

**O que é a opção "Abrir o card após criar"?**

Ao selecionar essa opção antes de criar, o sistema redireciona automaticamente para a tela de detalhes do card assim que ele for criado.

---

**O que são as tags de um card?**

São etiquetas personalizadas que você cria para categorizar o card. Exemplos: "Alta chance de fechamento", "Processo seletivo", "Conta congelada".

:::tip
Tags podem ser usadas como filtro para localizar cards específicos com rapidez.
:::

---

### 6. Cards — Detalhes e Gestão

**O que vejo na tela de detalhes de um card?**

- Título e telefone do contato
- Progresso pelos estágios da pipeline
- Tags atribuídas
- Proprietário e data de criação
- Valor estimado
- Status, prioridade e temperatura
- Campos personalizados
- Descrição
- Abas: Atividades, Tarefas, Notas e Atendimentos

---

**Como acompanho o histórico de um card?**

Acesse a aba **Atividades** dentro do card. Ela registra tudo automaticamente: notas criadas, tarefas adicionadas ou concluídas, movimentações de estágio e campos não preenchidos ao avançar.

---

**Posso visualizar rapidamente as informações de um card sem abri-lo?**

Sim. Passe o mouse sobre o card na tela da pipeline para ver uma pré-visualização com: título, valor, prioridade, status das tarefas, proprietário, data de criação, última nota e atendimentos.

A partir desse popover, você também pode:
- Abrir os detalhes completos do card
- Ir direto para o atendimento com o cliente

---

**Como acesso o atendimento do cliente a partir de um card?**

Dentro da tela de detalhes, clique no botão de conversa — ele abre o atendimento com o cliente diretamente.

---

### 7. Filtros e Views

**Quais filtros rápidos estão disponíveis?**

- **Status:** Perdido ou Concluído
- **Prioridade:** Urgente, Médio ou Baixo
- **Responsável:** Meus cards, Minha equipe ou Sem responsável
- **Origem:** WhatsApp, Instagram, E-mail, entre outros
- **Temperatura:** Quente, Morno ou Frio
- **Tags:** por tags customizadas criadas no contato

---

**O que são os atalhos de filtro?**

São filtros rápidos por período de atividade:

| Atalho | O que mostra |
|---|---|
| Cards atrasados | Cards com prazo vencido |
| Sem atividade nos últimos 7 dias | Cards sem movimentação recente |
| Criados hoje | Cards criados nas últimas 24h |
| Últimos 7 dias | Cards com atividade nos últimos 7 dias |
| Últimos 30 dias | Cards com atividade nos últimos 30 dias |

---

**Como uso os campos customizados nos filtros?**

Em **Filtros → Campos Customizados**, selecione o campo desejado (ex: CPF) e defina a condição:

- **É / Não é** — correspondência exata
- **Contém / Não contém**
- **Começa com / Termina com**
- **Está vazio / Não está vazio**

---

**O que são os filtros salvos (Views)?**

São combinações de filtros que você salva para reutilizar com um clique, sem precisar reconfigurar toda vez.

Como criar:
1. Ative os filtros desejados
2. Clique em **Salvar como View**
3. Nomeie a view (ex: "CPF + Status Concluído")

:::tip
Acesse suas views salvas pelo seletor **Views**, ao lado do botão de filtros. Você pode favoritar uma view para acesso ainda mais rápido.
:::

---

### 8. Tarefas e Notas

**Como crio uma tarefa em um card?**

Dentro da tela de detalhes, clique no botão **+** na aba **Tarefas**. Preencha:

- Título
- Status (ex: em andamento)
- Data inicial e data de encerramento
- Horário de início e término
- Descrição
- Responsável

---

**O que significa o símbolo de atenção (⚠️) em uma tarefa?**

Indica que a tarefa está atrasada — ou seja, a data de encerramento já passou e ela ainda não foi concluída.

---

**As tarefas aparecem no histórico do card?**

Sim. Toda tarefa criada, concluída ou alterada é registrada automaticamente na aba **Atividades**.

---

**Como crio uma nota em um card?**

Na aba **Notas**, clique em adicionar e preencha título e descrição. A nota também aparece na aba **Atividades** com data e hora de criação.

---

**Qual a diferença entre Notas e Descrição?**

| | Descrição | Nota |
|---|---|---|
| Onde fica | Campo fixo do card | Aba Notas |
| Quando usar | Contexto geral do card | Registros pontuais ao longo do tempo |
| Limite | 2.000 caracteres | — |

:::tip
Use a **Descrição** para o contexto inicial do card e as **Notas** para registrar acontecimentos ao longo do processo.
:::

---

### 9. Campos Obrigatórios e Tarefas Padrão

**O que são campos obrigatórios de um estágio?**

São campos que precisam estar preenchidos para que o card possa avançar para o próximo estágio.

Campos disponíveis: Proprietário, Valor estimado, Prioridade, Origem, Temperatura e campos customizados.

:::warning
Se o campo não estiver preenchido e você tentar mover o card, o sistema vai alertar. Você pode preencher na hora ou mover assim mesmo — mas o sistema registrará na aba Atividades que o card foi avançado com campos obrigatórios pendentes.
:::

---

**O que são campos customizados?**

São campos criados especificamente para o seu negócio — além dos campos padrão do CRM (título, valor, status, prioridade).

Exemplos: número do pedido, CPF, protocolo, nome do produto.

Tipos disponíveis: texto, número, entre outros.

---

**O que são tarefas padrão de um estágio?**

São tarefas que o sistema cria automaticamente sempre que um novo card entra naquele estágio — sem precisar criar manualmente.

Como configurar:
1. Acesse **Configurar Estágios**
2. Selecione o estágio desejado
3. Clique em **Tarefas Padrão → Adicionar tarefa**
4. Defina título, tipo, prazo (em dias úteis ou corridos) e responsável

:::tip
O prazo é contado a partir da data em que o card entra no estágio. Se você marcar apenas dias úteis, finais de semana são ignorados no cálculo.
:::

---

**Uma tarefa padrão pode ser obrigatória para avançar o card?**

Sim. Ao configurar a tarefa padrão, marque a opção **Obrigatório para avançar**. O card só poderá ir para o próximo estágio depois que essa tarefa for concluída.

---

### 10. Gerenciar Pipelines

**Como acesso a gestão geral das pipelines?**

Clique em **Gerenciar** no seletor de pipelines. A tela mostra todas as pipelines com visibilidade de: número de cards, valor total e taxa de conversão.

---

**Quais ações posso fazer em uma pipeline?**

| Ação | O que faz |
|---|---|
| Favoritar | Pipeline aparece no topo do seletor |
| Renomear | Altera o nome da pipeline |
| Tornar padrão | Abre essa pipeline automaticamente ao entrar no CRM |
| Duplicar | Cria uma cópia — com ou sem os cards existentes |
| Arquivar | Oculta a pipeline do seletor, preservando os cards |
| Exportar dados | Exporta todos os cards em Excel ou CSV |
| Editar pipeline | Reedita todos os campos de configuração |

---

**O que acontece quando eu arquivo uma pipeline?**

A pipeline fica oculta no seletor, mas todos os cards são preservados. Você pode desarquivar a qualquer momento — ela voltará visível para os usuários com permissão.

---

### 11. Permissões de Acesso

**Quais níveis de acesso existem em uma pipeline?**

| Nível | O que permite |
|---|---|
| Sem acesso | Não visualiza a pipeline |
| Ver | Visualiza, mas não edita nada |
| Editar | Move e edita cards, mas não altera a pipeline em si |
| Admin | Acesso total: cards e configurações da pipeline |

:::warning
Usuários administradores do sistema já têm nível Admin por padrão em todas as pipelines — esse nível não pode ser alterado.
:::

---

**Como adiciono um usuário específico a uma pipeline privada?**

1. Acesse **Gerenciar → Permissões da pipeline**
2. Clique em **Adicionar membro**
3. Busque o usuário pelo nome
4. Defina o nível de acesso (Ver, Editar ou Admin)
5. Salve as permissões

---

## Tutorial Guiado

Prefere seguir o passo a passo interativo? [Acesse a sessão de tutoriais guiados.](https://ihelpchat.github.io/ihelp-docs/tutoriais)
