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

Para acrescentar um teste ao `mcp:test`, crie o arquivo `mcp/<nome>.test.mjs`; o runner o descobre automaticamente.

`qa:ui` valida busca, páginas, FAQ, API, vídeo, workflow público do Tango, menus recolhíveis (mouse e teclado), assistente de IA (tela cheia, painel lateral, erro com nova tentativa, estado “não conectado”) com um serviço simulado, menu do celular e responsividade. Com `ASSISTANT_TEST=1`, pergunta também ao serviço de IA real.

`qa:visual` compara o site com o protótipo do Claude Design (projeto “Estrutura de docs ihelp”) em desktop (1440×1000) e mobile (390×844) e exige pelo menos 90% em duas medidas: pontos de controle (posição, tamanho e estilo de ~130 elementos, incluindo assistente, painel lateral e menus) e grade de cor da tela visível. Rode contra um build com `NEXT_PUBLIC_ASSISTANT_URL` definido (qualquer URL serve; o teste não chama a IA), porque o desenho mostra os pontos de entrada da IA. A referência fica em `scripts/fixtures/design-baseline.json` e contém só medidas; o protótipo não é versionado. Para atualizar a referência, baixe o protótipo pelo MCP `claude-design` para uma pasta fora do repositório, sirva essa pasta e rode `DESIGN_URL=http://127.0.0.1:4190/index.html npm run qa:visual:baseline`.

### Diferenças conscientes em relação ao protótipo

- **Cores:** quatro tons do protótipo não passam em contraste WCAG AA e foram trocados pelo tom acessível mais próximo (`scripts/visual/probes.mjs`, `accessibleColors`); o `qa:visual` lista cada ocorrência.
- **IA:** tela `/assistente`, painel lateral e botão flutuante seguem o desenho. Com `NEXT_PUBLIC_ASSISTANT_URL`, as perguntas vão para o serviço server-side; sem ele, a conversa mostra “Assistente não conectado” e oferece a busca, sem gerar resposta. A busca (⌘K) pergunta à IA com Enter quando ela está conectada; navegar pelas setas e dar Enter abre o resultado.
- **Tutoriais:** o menu “Módulos” usa as categorias reais dos guias. Os filtros “Para quem” e “Tema” do desenho não foram implementados porque os guias não têm esses dados; o botão “Iniciar no app” virou “Abrir no Tango”.
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

Contrato (`lib/assistant.ts`): `POST { question, history?, scope?, page?: { path, title } }` → `{ answer, steps?, code?, sources?: { title, path, excerpt? }[], suggestions?, found? }`. O cliente aceita o formato antigo (`answer` + `sources`) e qualquer serviço que siga o contrato.

O browser nunca recebe a chave da OpenAI. O endpoint `/assistant` roda junto do servidor HTTP do MCP, recupera os artigos mais relevantes localmente e chama a Responses API com `store: false`.

```bash
OPENAI_API_KEY=... ASSISTANT_ALLOWED_ORIGINS=http://127.0.0.1:4173 npm run mcp:http
NEXT_PUBLIC_ASSISTANT_URL=http://127.0.0.1:3100/assistant npm run build
```

O serviço pede resposta estruturada (JSON schema), filtra por escopo (“Buscar em”), prioriza a página aberta no painel lateral e só devolve fontes que ele mesmo recuperou, então o modelo não consegue inventar links. O modelo da resposta final é `OPENAI_MODEL` (padrão `gpt-6-luna`). Defina `ASSISTANT_ROUTER_MODEL` com um modelo pequeno para classificar mensagens quando houver guias publicados; sem ela, a triagem usa `OPENAI_MODEL` e avisa na subida. Há limite de 10 perguntas por IP/minuto e perguntas de até 500 caracteres.

## Publicação

Pull requests executam todas as validações. Merge em `main` publica o export estático no GitHub Pages. O MCP cria somente draft ou pull request; nunca faz merge ou deploy.
