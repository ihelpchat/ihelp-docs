# F5 aprovado — aplicação e provas em 17/11/2026

Aplicada a proposta aprovada pelo Bruno, incluindo → e as três trocas obrigatórias, aos drafts de usuario-acesso, recado-fora-do-horario e reconectar-canal-qr. Os dois primeiros foram portados aos MDX publicados pelo script existente; o QR v2 permanece rascunho e seu MDX publicado anterior não foi alterado. Os três roteiros novos de atendente continuam fora do pacote público.

StepIds, títulos, destinos, outcomes e versão 2 foram preservados; a escolha aprovada do recado passa a “Conferi texto e horário”. As duas páginas mantêm os comentários fonte por passo, com SHA, arquivo e linha de origem; o portador recalculou o alvo de escrever-recado para o rótulo aprovado “departamento” no mesmo arquivo/linha. A proposta registra “Aprovado por Bruno em 2026-11-17 com 3 trocas”.

`approve-canonical-guides.mjs` gerou o ledger e os campos globais do modelo existente foram preenchidos manualmente como aprovadoPor Bruno e aprovadoEm 2026-11-17, com a autorização explícita deste dispatch. As listas literais de frases controladas foram atualizadas para o texto aprovado. A geração inicialmente rejeitou U+2192; a allowlist de caracteres passou a permitir apenas essa seta adicional, com teste positivo e rejeição de ←, ⇒ e ↪, mantendo os demais gates.

## Pacote

Novo SHA: `7bcb2036a4b208f325894ecbe0451374ea596b7cea732a053faef1d8f14f1b99`.
Versão: `7bcb2036a4b2`, 3 guias publicados, arquivos `pilot/public/guides/7bcb2036a4b2/{catalog,app}.json` e manifest atualizado.
As versões anteriores, inclusive df4c501f54e2, foram preservadas. O baseline público passou sem exigir mudança de hash; `mcp/public-submit-baseline.json` não mudou.

## Provas pela fila

Wrapper: `/Users/bruno/.local/bin/mac-build-control run --host mac --wait --cwd "$PWD/pilot" -- bash /tmp/f5-approved-checks.sh`.
Job `91a923aafa004408`, pueue `12919`, rc global **0**. O script executou cada check separadamente e registrou seu rc, sem interromper o lote na primeira falha. O PATH compatível com Git arm64 foi selecionado dentro do job já admitido, como na prova anterior; não houve bypass da fila.

```text
PROOF_RC=0 COMMAND=npm run -s content:validate
PROOF_RC=0 COMMAND=node scripts/generate-guide-package.mjs --check
PROOF_RC=0 COMMAND=node architecture/widget-guides-drafts/validate.mjs /Users/bruno/orca/workspaces/ihelp-react/widget-tour-release-1211
PROOF_RC=0 COMMAND=node mcp/canonical-guides-approval.test.mjs
PROOF_RC=0 COMMAND=node mcp/canonical-guides.test.mjs
PROOF_RC=0 COMMAND=node mcp/guide-package-public-gate.test.mjs
PROOF_RC=0 COMMAND=node mcp/guide-package-rework-r3.test.mjs
PROOF_RC=0 COMMAND=node mcp/guide-package-rework-r4.test.mjs
PROOF_RC=0 COMMAND=node mcp/guide-package.test.mjs
PROOF_RC=0 COMMAND=node mcp/widget-config.test.mjs
PROOF_RC=0 COMMAND=node mcp/widget-guides-drafts.test.mjs
PROOF_RC=0 COMMAND=node mcp/top-support-intents.test.mjs
PROOF_RC=0 COMMAND=node mcp/public-submit-baseline.test.mjs
```

O baseline informou 16 páginas válidas e 53 falhas legadas preservadas. O teste de intenções concluiu as nove intenções pelo fluxo answerQuestion completo. Testes HTTP usam provider fixture e fecham seus servidores em finally; nenhum processo foi encerrado por comando. Nenhum container ou recurso faturável foi criado, nenhum processo de teste deste job ficou ativo; logs de prova foram preservados.

`npm run -s build`: **NOT_RUN**, etapa opcional condicionada a recursos neste dispatch. A máquina apresentou pressão de memória 2, cerca de 14 GB de swap e load de 57 a 70, com consultas de status da fila intermitentes; o lote de testes permaneceu ativo até concluir. Não foi aberta outra execução pesada nem repetida suíte verde.

## Sincronização do front — somente leitura nesta entrega

Checkout consultado: `/Users/bruno/orca/workspaces/ihelp-react/widget-tour-release-1211`. Nenhum arquivo do frontend foi editado.

1. `src/features/help-assistant/published-guides.docs.json`: regenerar com `node scripts/help-assistant-published.mjs <checkout-docs>` depois deste commit; traz o pacote 7bcb2036a4b2 e o SHA completo acima.
2. `src/features/help-assistant/__tests__/contract.test.ts`: no teste do catálogo publicado, atualizar o pin do commit docs e a versão esperada de df4c501f54e2 para 7bcb2036a4b2; alinhar também o pin da URL de guide-ids se a release exigir provenance única (o conteúdo de guide-ids não mudou).
3. `src/features/help-assistant/publishedGuides.ts`: atualizar o comentário de provenance com o novo pacote e commit docs.
4. `src/features/help-assistant/task-guides.drafts.json`: regenerar com `node scripts/help-assistant-drafts.mjs <checkout-docs>` para carregar o texto aprovado do QR e atualizar docsSha; os dois drafts publicados continuam fora dessa cópia de piloto.
5. `scripts/help-assistant-ci.mjs`: seu pin atual a826334a... consulta apenas product-actions.json, cujos bytes não mudaram; pode ser alinhado ao commit desta entrega para provenance única, sem necessidade de mudar product-actions.docs.json. Os scripts help-assistant-published.mjs e help-assistant-drafts.mjs são os pontos de geração; não precisam de alteração de comportamento só por esta troca de texto/pacote.

Os pins que fazem curl/fetch de raw.githubusercontent.com só podem ser validados quando o commit estiver disponível no remote. Esta entrega é commit local, sem push ou deploy; a sincronização e os testes do front pertencem ao outro worker.
