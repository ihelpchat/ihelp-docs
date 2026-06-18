---
title: "Quanto custa?"
---

Essa é uma das perguntas mais importantes antes de migrar — e também uma das que mais gera confusão. O custo da API Oficial não é uma cobrança única: ele é composto por duas camadas independentes, cobradas por entidades diferentes. Entender cada uma delas evita surpresas na fatura.

***

**1. GupShup — o provedor do número**

A GupShup é a empresa parceira da Meta responsável por hospedar o número na nuvem e processar o tráfego de mensagens. A cobrança é variável:

* **U$ 0,001 por mensagem trafegada** — ou seja, toda mensagem enviada ou recebida pelo número gera esse custo

***

**2. Meta — cobrança por template entregue**

A Meta cobra por cada mensagem de template entregue ao destinatário. O valor varia conforme a categoria do template e é cobrado em dólares. Os valores vigentes para o Brasil a partir de 01/04/2026 são:

| Categoria    | Custo por mensagem entregue |
| ------------ | --------------------------- |
| Marketing    | U$ 0,0625                   |
| Utilidade    | U$ 0,0080                   |
| Autenticação | U$ 0,0225                   |

Alguns pontos importantes sobre a cobrança da Meta:

* A cobrança acontece no momento da **entrega** — não do envio. Se a mensagem não for entregue, não é cobrada
* Mensagens de **Utilidade enviadas dentro de uma janela de 24h aberta** são gratuitas na camada da Meta — o custo se aplica apenas quando a janela está fechada
* Templates de **Utilidade e Autenticação** têm **desconto por volume**: quanto mais mensagens enviadas no mês, menor o custo unitário
* Leads vindos de anúncios **click-to-WhatsApp** geram uma janela de 72 horas em que a Meta não cobra por categoria de template

:::info[Observação]
Os valores da Meta são atualizados periodicamente. Consulte sempre a tabela oficial em [whatsappbusiness.com/pt-br/products/platform-pricing](https://whatsappbusiness.com/pt-br/products/platform-pricing/) para confirmar os valores mais recentes.
:::

***

**Como estimar o custo mensal**

Para ter uma estimativa realista, considere duas variáveis:

**Volume de templates enviados** — quantas mensagens ativas sua empresa dispara por mês e em qual categoria. Um envio de 1.000 templates de Marketing, por exemplo, gera U$ 62,50 de custo Meta.

**Volume de mensagens trafegadas** — a soma de tudo que entra e sai pelo número. Uma operação com 10.000 mensagens trocadas no mês gera U$ 10 na GupShup. Acima de 75.000 mensagens, o teto de U$ 75 já está atingido.
