# Provas F5 — 17/11/2026

Escopo: proposta editorial, três rascunhos source-only e validação local. Sem alteração dos MDX publicados, do ledger, da allowlist canônica ou dos artefatos em `public/guides`. Sem push, deploy, container ou infraestrutura criada.

## Resultados pela fila global

- `npm run -s content:validate`: rc 0 no job `a9eac4497a3a44b5` (pueue 12890); 22 módulos, pacote de 3 guias e SHA `df4c501f54e21d77b43a91b21aa998a83342df8ae14fa2fc0ad374d19af1563f`. O job completo terminou rc 1 no validator seguinte, que ainda exigia IDs canônicos; essa falha foi corrigida com schema exclusivo de rascunhos. Conteúdo, compiler e pacote não mudaram depois desta prova.
- `node mcp/widget-config.test.mjs`: rc 0 no job `06b4341cdf094523` (pueue 12892); padrão fechado, lista de empresas, piloto restrito e leitura sem provider real. O mesmo job diagnosticou `git` incompatível no PATH e executou `widget-guides-drafts.test.mjs` com rc 0; o rc global 0 não é usado como prova do validator, que falhou nesse job.
- `node architecture/widget-guides-drafts/validate.mjs /Users/bruno/orca/workspaces/ihelp-react/widget-tour-release-1211`: rc 0 no job `719813f32e3c4824` (pueue 12895); 6 drafts, 2 publicados iguais às páginas, 26 blobs conferidos no SHA, grafo completo, publicação desativada nos novos.
- `node mcp/widget-guides-drafts.test.mjs`: rc 0 no mesmo job `719813f32e3c4824`; confirma limite de 200 caracteres, IDs novos rejeitados pelo contrato publicado, refinements preservadas, bloqueio/pausa por ação, confirmação final e ausência dos novos IDs no pacote com SHA completo exigido.

O job final executou, dentro do wrapper obrigatório, `bash -lc 'export PATH="/opt/homebrew/bin:/usr/bin:$PATH"; set -e; node architecture/widget-guides-drafts/validate.mjs /Users/bruno/orca/workspaces/ihelp-react/widget-tour-release-1211; node mcp/widget-guides-drafts.test.mjs'` com cwd `pilot`. O ajuste de PATH seleciona Git arm64: o ambiente de login da fila encontrava primeiro `/usr/local/bin/git`, que retornava `Bad CPU type in executable` / `spawnSync git Unknown system error -86`; o Apple Git e o Homebrew Git arm64 funcionam. Não houve alteração da fila nem execução de teste fora dela.

O teste de widget fecha seus servidores de fixture e remove seu diretório temporário em `finally`; o job terminou rc 0. Nenhum processo foi encerrado por comando. Cleanup dos fixtures concluído; nenhuma infraestrutura criada ou cleanup pendente.

## Pendências de aceite

Aprovação editorial do Bruno e jornada real autorizada, inclusive layout em 360×640, persistência e permissões. As 17 âncoras propostas ausentes estão enumeradas em `PROPOSTA-TEXTOS-F5.md`; o frontend não foi editado. A descoberta dos novos IDs no catálogo de piloto exige configuração explícita de guia e empresa e não os publica no pacote canônico.
