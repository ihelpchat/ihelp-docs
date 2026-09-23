# Documentação iHelp

Nova central de ajuda em Next.js, Fumadocs e MDX. O projeto reúne FAQ, tutoriais Tango, referência da API, busca local e conteúdo preparado para consumo por IA.

## Desenvolvimento

```bash
npm ci
npm run dev
```

## Validação

```bash
npm run content:validate
npm run mcp:test
npm run types:check
npm run lint
npm run build
npm start
npm run qa:ui
npm run qa:visual
```

`qa:ui` valida busca, páginas, FAQ, API, vídeo, Tango, menu do celular e responsividade.

`qa:visual` compara o site com o protótipo do Claude Design (projeto “Estrutura de docs ihelp”) em desktop (1440×1000) e mobile (390×844) e exige pelo menos 90% em duas medidas: pontos de controle (posição, tamanho e estilo de ~90 elementos) e grade de cor da tela visível. A referência fica em `scripts/fixtures/design-baseline.json` e contém só medidas; o protótipo não é versionado. Para atualizar a referência, baixe o protótipo pelo MCP `claude-design` para uma pasta fora do repositório, sirva essa pasta e rode `DESIGN_URL=http://127.0.0.1:4190/index.html npm run qa:visual:baseline`.

### Diferenças conscientes em relação ao protótipo

- **Cores:** quatro tons do protótipo não passam em contraste WCAG AA e foram trocados pelo tom acessível mais próximo (`scripts/visual/probes.mjs`, `accessibleColors`); o `qa:visual` lista cada ocorrência.
- **Pendente:** resposta do assistente de IA na busca. Hoje a busca é local; a integração com IA entra no próximo ciclo e usa o mesmo modal.
- **Não implementado por falta de dado real ou por segurança:** card “Onde pegar o seu token” via DevTools (a documentação proíbe esse método), cartão “Limite 120 req/min” e tabela “Códigos de erro” da API (não documentados), selo “Conteúdo verificado” (não existe revisão registrada), passo a passo com marcação de clique dos tutoriais (os guias no Tango são privados e exigem login), links “Status” e “Termos” do rodapé (sem URL oficial).
- **Controle do protótipo:** o seletor “Variante de layout A/B” do endpoint não vai para o produto; usamos a variante B (coluna única com índice).

## Conteúdo

- `content/docs`: artigos MDX publicados.
- `architecture/coverage-matrix.json`: módulos reais, permissões e lacunas editoriais.
- `scripts/migrate-content.mjs`: migração repetível do conteúdo legado.
- `mcp`: servidor que permite à IA consultar, validar e propor conteúdo.

O build padrão gera export estático em `out`. Para GitHub Pages, use `NEXT_PUBLIC_BASE_PATH=/ihelp-docs npm run build`.

## Publicação

Pull requests executam todas as validações. Merge em `main` publica o export estático no GitHub Pages. O MCP cria somente draft ou pull request; nunca faz merge ou deploy.
