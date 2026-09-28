# Contexto de negócio privado

Esta pasta do repositório público contém apenas este README e `_modelo.md`. O conteúdo de negócio mora no segundo cérebro privado. Nunca copie os arquivos de contexto para este repositório.

O MCP lê os arquivos convertidos em tempo de execução da pasta indicada por `BUSINESS_CONTEXT_DIR`, fora do repositório. No Railway, configure `GITHUB_READ_TOKEN` com acesso somente de leitura ao segundo cérebro privado e `MCP_STATE_DIR=/data`. A cópia fica no volume em `/data/business-context/current` e é atualizada na inicialização e a cada 36 horas. Sem token e sem cópia local, o carregador retorna vazio e o juiz marca as frases como **a confirmar**. Localmente, aponte `BUSINESS_CONTEXT_DIR` para uma cópia convertida fora do repositório.

O carregador aceita somente arquivos `🟢 PÚBLICO` sem marcadores internos ou dados sensíveis. Ele carrega `geral.md` junto do arquivo do módulo. O que a IA escrever na página do FAQ a partir desse contexto fica público, pois a página é pública; o arquivo de contexto inteiro permanece privado.
