# Matriz de cobertura

`coverage-matrix.json` liga cada módulo real do produto às rotas, permissões, páginas e recursos existentes. Ela é validada no build e serve como backlog editorial para FAQs e Tangos.

- `complete`: FAQ/guia e recurso visual cobrem o fluxo principal.
- `partial`: existe conteúdo, mas faltam fluxos, erros, permissões ou recurso visual.
- `missing`: o módulo ainda não tem conteúdo publicado.

Priorize primeiro os itens `P0`, depois os gaps `P1`. Instabilidade, falhas de entrega, bloqueios Meta e incidentes precisam de diagnóstico e escalação; não devem virar apenas tutorial.
