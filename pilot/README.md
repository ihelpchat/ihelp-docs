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
npm run content:audit
npm run mcp:test
npm run types:check
npm run lint
npm run build
npm start
npm run qa:ui
npm run qa:visual
```

`qa:ui` valida busca, páginas, FAQ, API, vídeo, workflow público do Tango, menu do celular e responsividade.

`qa:visual` compara o site com o protótipo do Claude Design (projeto “Estrutura de docs ihelp”) em desktop (1440×1000) e mobile (390×844) e exige pelo menos 90% em duas medidas: pontos de controle (posição, tamanho e estilo de ~90 elementos) e grade de cor da tela visível. A referência fica em `scripts/fixtures/design-baseline.json` e contém só medidas; o protótipo não é versionado. Para atualizar a referência, baixe o protótipo pelo MCP `claude-design` para uma pasta fora do repositório, sirva essa pasta e rode `DESIGN_URL=http://127.0.0.1:4190/index.html npm run qa:visual:baseline`.

### Diferenças conscientes em relação ao protótipo

- **Cores:** quatro tons do protótipo não passam em contraste WCAG AA e foram trocados pelo tom acessível mais próximo (`scripts/visual/probes.mjs`, `accessibleColors`); o `qa:visual` lista cada ocorrência.
- **IA:** o modal consulta o serviço server-side do MCP quando `NEXT_PUBLIC_ASSISTANT_URL` está configurado. Sem o endpoint, continua funcionando como busca local e não promete resposta de IA.
- **Tango:** os workflows são públicos, mas o iframe de embed exige login. O site abre o workflow público em vez de mostrar um player quebrado para visitantes anônimos.
- **Não implementado por falta de dado real ou por segurança:** card “Onde pegar o seu token” via DevTools (a documentação proíbe esse método), cartão “Limite 120 req/min” e tabela “Códigos de erro” da API (não documentados), selo “Conteúdo verificado” (não existe revisão registrada) e links “Status” e “Termos” do rodapé (sem URL oficial).
- **Controle do protótipo:** o seletor “Variante de layout A/B” do endpoint não vai para o produto; usamos a variante B (coluna única com índice).

## Conteúdo

- `content/docs`: artigos MDX publicados.
- `architecture/editorial-standard.md`: padrão obrigatório para FAQ, tutorial, guia e referência.
- `architecture/coverage-matrix.json`: módulos reais, permissões e lacunas editoriais.
- `npm run content:migrate`: importa somente rotas legadas ausentes e aplica a normalização editorial; nunca sobrescreve artigos já revisados.
- `mcp`: servidor que permite à IA buscar, ler, auditar, validar e propor conteúdo.

O build padrão gera export estático em `out`. Para GitHub Pages, use `NEXT_PUBLIC_BASE_PATH=/ihelp-docs npm run build`.

## Assistente GPT

O browser nunca recebe a chave da OpenAI. O endpoint `/assistant` roda junto do servidor HTTP do MCP, recupera os artigos mais relevantes localmente e chama a Responses API com `store: false`.

```bash
OPENAI_API_KEY=... ASSISTANT_ALLOWED_ORIGINS=http://127.0.0.1:4173 npm run mcp:http
NEXT_PUBLIC_ASSISTANT_URL=http://127.0.0.1:3100/assistant npm run build
```

O modelo padrão é `gpt-6-luna`; `OPENAI_MODEL` permite trocar sem alterar código. Há limite de 10 perguntas por IP/minuto e perguntas de até 500 caracteres.

## Publicação

Pull requests executam todas as validações. Merge em `main` publica o export estático no GitHub Pages. O MCP cria somente draft ou pull request; nunca faz merge ou deploy.
