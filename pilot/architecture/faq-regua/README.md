# M5.74 — escopo e régua do FAQ

Estes artefatos fixam a pauta e a régua para as próximas entregas. `tarefas-ouro.json` é uma lista de resultados a provar pela M5.71, não um selo de que todos os comportamentos já foram observados. “E agora?” permanece hipótese até a jornada e o time confirmarem. O revisor verifica rastreabilidade e coerência dos artefatos; a nota editorial depende da avaliação cega do Bruno.

## Baseline de 29/09/2026

As duas execuções usaram o gerador do checkout `946286e` (M5.73), `ex-faq2.sh` e os pedidos `req-faq-agenda.json` e `req-faq-robo.json` do diretório externo `.regente/exercicios/`. O script usa `BUSINESS_CONTEXT_DIR` externo ao repositório e variáveis da configuração de staging. Rode cada exercício com saída temporária fora do repo e o quarto argumento apontando para este checkout:

```text
bash /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/ex-faq2.sh /tmp/m574-agenda /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/req-faq-agenda.json docs/sobre-o-sistema/agenda-de-contatos <checkout>
bash /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/ex-faq2.sh /tmp/m574-robo /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/req-faq-robo.json docs/sobre-o-sistema/robo-de-atendimento <checkout>
```

O modelo pode variar entre execuções. Em `baseline/` há apenas os MDX gerados e um `result.json` **reduzido a métricas** por página; o `result.json` bruto e as respostas do modelo ficaram fora do repo porque podem repetir contexto privado. “Completa” exige conclusão e verificação observável, não só abrir a função ou mostrar um spinner. Agenda: 0/7; Robô: 1/4 no texto, mas a publicação é ação proibida ao agente. Os arquivos de métricas detalham pendências, marcações “a confirmar” e perdas de montagem.

As amostras de calibração estão separadas da chave de fontes. O regente entrega apenas `amostras-calibracao.json` ao Bruno para a nota cega; `amostras-calibracao-fontes.json` serve para analisar divergências depois. Nenhuma amostra contém dado real de cliente.
