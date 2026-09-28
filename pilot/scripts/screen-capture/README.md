# Captura das telas do FAQ

`node scripts/screen-capture/run.mjs pedido.json` recebe `page`, `module` e,
opcionalmente, `tasks` (nomes das tarefas a capturar). O servidor monta o plano
dos fatos da tela da cópia de leitura do front. Não recebe passos, rótulos,
`owner`, `screenFacts` ou SHA do chamador. Apenas controles de abertura ou
navegação podem receber clique; ações de gravação e destrutivas são fotografadas
sem clique. O manifesto registra o hash do bundle da homologação.
`uploads` locais podem listar `{page, step, file, alt, approved: true}` após
revisão humana do PNG. O `step` vem do manifesto ou do plano gerado; o upload
prevalece sobre a captura automática.

Configure `GUIDE_QA_STAGING_URL` e `GUIDE_QA_ALLOWED_HOSTS` como no guide-proof.
No uso local, `GUIDE_QA_STORAGE_STATE` aponta para sessão salva manualmente fora
do repositório. No CI, use `GUIDE_QA_AUTHORIZED_EMAIL/PASSWORD` em secrets.
O host de produção é recusado. PNGs e manifesto ficam em
`MCP_STATE_DIR/screens/` (padrão `/data/screens/`), fora do Git. Revise os PNGs
antes de publicar.

No serviço MCP, `capturar_telas` exige credencial de escrita e recebe página,
módulo e tarefas opcionais. `enviar_tela` exige a mesma credencial, PNG em base64
e aprovação humana de privacidade. O login usa apenas os secrets do servidor.
`baixar_telas` exige autenticação e devolve até quatro PNGs por chamada, com teto de bytes.
Ao enviar um artigo para PR, o MCP inclui apenas as imagens citadas no corpo.
