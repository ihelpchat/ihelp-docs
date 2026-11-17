# Fase 3: guias gerados no MCP

O caminho novo só entra em perguntas de procedimento depois da triagem dos guias publicados. Reutiliza os passos MDX publicados e as rotas das ações recuperadas; sem sessão, sem mapa aplicável ou sem client, mantém a resposta atual.

Cada candidato precisa passar pelo contrato (máximo 12 passos, grafo explícito acíclico), catálogo de rotas, `resolveLocator`, regra de rótulos do public-submit-gate e `classifyAnswerSafety`. O texto de cada passo precisa ser cópia exata de um passo documentado. Qualquer rejeição registra somente um código interno e volta ao caminho de texto existente.

Geração e classificação usam provider-budget. O cache de 30 minutos inclui pergunta normalizada, conteúdo do mapa e passos documentados; tem limite de 500 entradas. A máquina guarda até 1000 pares de sessão e guia por 30 minutos, exige o mesmo stateToken assinado e suporta próximo, voltar, handoff e pausa. Reiniciar o processo invalida o cache e os tokens, como já acontece com os tokens publicados.

Feedback preserva guideId, stepId e contadores missing/ambiguous. O resumo de feedback expõe avaliações por guia; para uso real por sessões únicas e ranking de avaliações:

```sh
node scripts/generated-guide-report.mjs /caminho/conversations.jsonl /caminho/feedback.jsonl
```

O script só lê arquivos existentes; não faz deploy nem altera infra. O liga/desliga central existente continua no HTTP, antes do assistente; não há filtro de empresa novo. O app precisará da Fase 4 para executar generatedGuide.

Provas e custo serão registrados no corpo da PR. Nenhuma chamada real à IA foi feita: custo US$ 0. Pacote publicado SHA 7bcb2036a4b208f325894ecbe0451374ea596b7cea732a053faef1d8f14f1b99 e canonical-guides.approved.json preservados.

## Verificação desta entrega

Matriz efetiva completa: **185/185 arquivos, rc=0**, registrada em `generated-guides-phase3-tests.json`. O primeiro `npm run -s mcp:test` terminou com rc=1 em schema-boundary: a nova entrada stepId de feedback aceitava uma sentinela com formato de segredo. A correção usa a regra existente de dados sensíveis. Foram reaproveitados os 168 arquivos anteriores com rc=0, repetidos schema-boundary e os testes diretamente afetados e executados os 16 arquivos restantes (todos rc=0). Não houve falha por carga nem necessidade de replay em ae1f42d.

Também passaram: seis testes novos (schema/grafo/limite, validação dura, estado assinado por sessão, cache/invalidação do mapa, feedback e integração do assistente), contratos existentes, session-events HTTP, data-minimization, fixture do relatório, tipos gerados e `content:validate`, todos rc=0. Após o último ajuste de feedback, os testes afetados foram repetidos; a suíte completa não foi duplicada. Cleanup das fixtures próprias concluído, sem recursos de infra criados.
