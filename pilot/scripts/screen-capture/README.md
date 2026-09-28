# Captura das telas do FAQ

`node scripts/screen-capture/run.mjs plano.json` recebe `page`, `module`, `appSha`,
`screenFacts` da M5.58 e `steps` ordenados (`id`, `role`, `label`, `route`, `action`).
Cada rota é conferida na coverage matrix e cada rótulo deve ter fato da tela com
dono e SHA. Use `action: "click"` para abrir o próximo passo; a imagem é tirada
antes do clique. Não use seletores CSS no plano.
`uploads` pode listar `{page, step, file, alt, approved: true}` após revisão
humana do PNG; esses arquivos substituem a captura automática do passo.

Configure `GUIDE_QA_STAGING_URL` e `GUIDE_QA_ALLOWED_HOSTS` como no guide-proof.
No uso local, `GUIDE_QA_STORAGE_STATE` aponta para sessão salva manualmente fora
do repositório. No CI, use `GUIDE_QA_AUTHORIZED_EMAIL/PASSWORD` em secrets.
O host de produção é recusado. A saída fica em `pilot/public/img/mcp/`, ignorada
pelo Git. Revise os PNGs antes de publicar; screenshots enviados manualmente
precisam de aprovação de privacidade e têm prioridade no manifesto.

No serviço MCP, `capturar_telas` exige credencial de escrita e recebe página,
módulo, SHA do app, passos e fatos da tela. O login usa apenas os secrets do
servidor e grava PNGs e manifesto em `/data/screens/`. `baixar_telas` exige
autenticação e devolve até quatro PNGs por chamada, com teto de bytes.
Ao enviar um artigo para PR, o MCP inclui apenas as imagens citadas no corpo.
