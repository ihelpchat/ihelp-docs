# M5.74 — escopo e régua do FAQ

## M5.79 — guia aprendido

`guia-aprendido.json` registra todas as lições com a medição individual. Só as lições `ativa: true`, validadas e não vetadas entram como âncoras adicionais no prompt do **juiz**. As recusadas constam em `observacoes-aprendizado.json` e não calibram o juiz. `vetada` é o veto manual do Bruno, separado da recusa pelo portão. O contrato do **redator** continua incluindo as orientações editoriais já estabelecidas na M5.76, mesmo quando a lição correspondente não melhora a concordância do juiz. O glossário e as demais regras de escrita da M5.76 seguem aplicáveis. A validação do juiz compara cada amostra guardada antes e depois, além dos agregados, usando três leituras com mediana.

`origem.classe` distingue `regra-do-dono` de `aprendida`. O redator recebe regras do dono não vetadas e lições aprendidas ativas; o juiz recebe somente lições ativas. Uma candidata aprendida recusada fica apenas nas observações. `FEEDBACK_DIR` aponta para um diretório privado fora do repo, com arquivos JSON: cada arquivo contém uma revisão `{ pagina, secao, titulo, decisao, comentario }` ou coleções `secoes`/`amostras`. As páginas publicadas são localizadas pela origem da revisão; o digest inclui apenas os arquivos de feedback e o texto localizado, excluindo saídas geradas. Cache e marcador de processamento ficam em `FEEDBACK_DIR/.saida/`. Sem `FEEDBACK_DIR`, `CALIBRATION_NOTES_FILE` e `REVIEW_NOTES_FILE` preservam a execução anterior; seu diretório também deve ficar fora do repo. O sorteio ajuste/guardado usa o id de cada caso, de modo que novos casos não redistribuem os antigos.

As candidatas só usam palavras da rubrica, do `glossario-licoes.json`, das lições ativas do guia e de `vocabulario-licoes.json`. Palavras fora dessa lista são recusadas com motivo `vocabulário`, sem persistir o texto da candidata. O corpus de páginas não amplia a lista. Para gerar a fila privada de seções sem revisão, defina `FEEDBACK_DIR` e `FEEDBACK_QUEUE_FILE` fora do repositório e rode `node pilot/scripts/fila-calibracao.mjs` na raiz. O JSON contém `id`, `pagina`, `titulo` e `texto` das seções públicas, em ordem determinística.

Estes artefatos fixam a pauta e a régua para as próximas entregas. `tarefas-ouro.json` é uma lista de resultados a provar pela M5.71, não um selo de que todos os comportamentos já foram observados. “E agora?” permanece hipótese até a jornada e o time confirmarem. O revisor verifica rastreabilidade e coerência dos artefatos; a nota editorial depende da avaliação cega do Bruno.

## Baseline de 29/09/2026

As duas execuções usaram o gerador do checkout `946286e` (M5.73), `ex-faq2.sh` e os pedidos `req-faq-agenda.json` e `req-faq-robo.json` do diretório externo `.regente/exercicios/`. O script usa `BUSINESS_CONTEXT_DIR` externo ao repositório e variáveis da configuração de staging. Rode cada exercício com saída temporária fora do repo e o quarto argumento apontando para este checkout:

```text
bash /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/ex-faq2.sh /tmp/m574-agenda /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/req-faq-agenda.json docs/sobre-o-sistema/agenda-de-contatos <checkout>
bash /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/ex-faq2.sh /tmp/m574-robo /Users/bruno/Projects/ihelp-cs/faq-claricia/.regente/exercicios/req-faq-robo.json docs/sobre-o-sistema/robo-de-atendimento <checkout>
```

O modelo pode variar entre execuções. Em `baseline/` há apenas os MDX gerados e um `result.json` **reduzido a métricas** por página; o `result.json` bruto e as respostas do modelo ficaram fora do repo porque podem repetir contexto privado. “Completa” exige conclusão e verificação observável, não só abrir a função ou mostrar um spinner. Agenda: 0/7; Robô: 1/4 no texto, mas a publicação é ação proibida ao agente. Os arquivos de métricas detalham pendências, marcações “a confirmar” e perdas de montagem.

As amostras de calibração estão separadas da chave de fontes. O regente entrega apenas `amostras-calibracao.json` ao Bruno para a nota cega; `amostras-calibracao-fontes.json` serve para analisar divergências depois. Nenhuma amostra contém dado real de cliente.
