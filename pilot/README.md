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

`qa:ui` valida busca, páginas, vídeo, Tango e responsividade. `qa:visual` exige pelo menos 90% de aderência ao desenho aprovado.

## Conteúdo

- `content/docs`: artigos MDX publicados.
- `architecture/coverage-matrix.json`: módulos reais, permissões e lacunas editoriais.
- `scripts/migrate-content.mjs`: migração repetível do conteúdo legado.
- `mcp`: servidor que permite à IA consultar, validar e propor conteúdo.

O build padrão gera export estático em `out`. Para GitHub Pages, use `NEXT_PUBLIC_BASE_PATH=/ihelp-docs npm run build`.

## Publicação

Pull requests executam todas as validações. Merge em `main` publica o export estático no GitHub Pages. O MCP cria somente draft ou pull request; nunca faz merge ou deploy.
