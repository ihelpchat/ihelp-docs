# Plano — Site de Documentação iHelp (Docusaurus)

> Documento de planejamento. Nada é implementado até este plano ser aprovado.
> Data: 2026-06-15 · Autor: Gian (gianpm)

---

## 1. Objetivo

Criar **um único site** em [Docusaurus 3](https://docusaurus.io) que reúna:

1. **Central de Ajuda (FAQ)** — as ~45 páginas em pt-BR exportadas do GitBook (`faq.ihelpchat.com`).
2. **Documentação de API** — o conteúdo hoje no site MkDocs separado (`ihelp-docs-api`), migrado para dentro do Docusaurus como conteúdo estático (sem replicar o sync do vault Obsidian; passa a ser mantido aqui).
3. **Blog "Novidades e Atualizações"** — as atualizações de produto, com fluxo simples de postagem.

Publicar no **GitHub Pages** a partir do repositório `github.com/ihelpchat/ihelp-docs`.

### Decisões já fechadas

| Tema | Decisão |
|---|---|
| Framework | Docusaurus 3 (preset `classic`, TypeScript) |
| Idioma | `pt-BR` (locale único) |
| Doc de API | **Migrar** para dentro do Docusaurus (sem sync do vault) |
| Blog | File-based; postagem via **GitHub web/Git**. Decap CMS = documentado, **fora do escopo agora** |
| Hospedagem | **GitHub Pages**, caminho padrão |
| URL final | `https://ihelpchat.github.io/ihelp-docs/` |
| `baseUrl` | `/ihelp-docs/` |
| Repositório | `github.com/ihelpchat/ihelp-docs` (branch `main`) |
| Busca | Plugin de busca local (offline, funciona no GitHub Pages, suporta pt) |

---

## 2. Arquitetura do site

### 2.1 Information Architecture (navbar)

```
Logo iHelp │ Central de Ajuda │ API │ Novidades │ [GitHub]
```

- **Central de Ajuda** → instância de docs padrão em `/docs` (conteúdo FAQ pt-BR, usuário final).
- **API** → segunda instância de docs em `/api` (conteúdo dev, sidebar própria).
- **Novidades** → blog em `/blog`.
- **Home** (`/`) → landing simples com 3 cards apontando para Ajuda, API e Novidades.

> Usar **duas instâncias de docs** é o padrão idiomático do Docusaurus para separar
> conteúdo de público diferente (usuário final vs. desenvolvedor), cada uma com sua sidebar.

### 2.2 Estrutura de pastas alvo

```
ihelp-doc/
├── docusaurus.config.ts        # url, baseUrl, i18n, navbar, footer, plugins
├── sidebars.ts                 # sidebar da Central de Ajuda (autogerada)
├── sidebarsApi.ts              # sidebar da API (manual/autogerada)
├── package.json
├── tsconfig.json
├── src/
│   ├── css/custom.css          # cores da marca (verde iHelp)
│   ├── components/
│   │   └── VideoEmbed.tsx      # componente p/ embeds (tella.tv, YouTube)
│   └── pages/
│       └── index.tsx           # landing page
├── docs/                       # Central de Ajuda (migrado do export GitBook)
│   ├── primeiros-passos/
│   ├── sobre-o-ihelp/
│   ├── sobre-o-sistema/
│   │   ├── campanhas/
│   │   └── configuracoes/
│   ├── whatsapp-business-api/
│   └── duvidas-e-dicas/
├── api/                        # Documentação de API (migrado do MkDocs)
│   ├── regras-da-meta.md
│   ├── autenticacao.md
│   ├── ... (1 página por seção H2)
│   └── _category_.json
├── blog/                       # Novidades e Atualizações
│   ├── authors.yml
│   ├── tags.yml
│   └── YYYY-MM-DD-*.md
├── static/
│   └── img/
│       ├── help/               # imagens da Ajuda baixadas do FAQ antigo
│       └── api/                # imagens da doc de API (8 PNGs)
├── scripts/
│   ├── migrate-gitbook.mjs     # converte export GitBook → docs/ + blog/
│   ├── migrate-api.mjs         # converte MkDocs index.md → api/*.md
│   └── download-images.mjs     # baixa imagens remotas do FAQ p/ static/
├── .github/workflows/deploy.yml
├── .gitignore
└── README.md
```

---

## 3. Fontes de conteúdo (inventário)

| Fonte | Caminho | Conteúdo |
|---|---|---|
| Export FAQ | `…\Documents\ihelp-docs-export\ihelp-docs-md` | 47 arquivos `.md`, ~45 páginas, pt-BR, sintaxe GitBook |
| Inventário de mídia | `…\ihelp-docs-md\MEDIA.md` | 96 itens (imagens remotas + vídeos) — usado só como referência p/ download |
| Doc de API | `…\Code\ihelp-docs-api\docs\index.md` | 889 linhas, ~25 seções H2, sintaxe MkDocs/pymdownx |
| Imagens da API | `…\ihelp-docs-api\docs\assets\*.png` | 8 PNGs locais |
| Novidades | `…\ihelp-docs-md\novidades-e-atualizacoes.md` | 6 atualizações datadas → vira o blog |

### Notas sobre as fontes
- Imagens da Ajuda são **URLs remotas** (`faq.ihelpchat.com/files/<id>`, sem extensão) — não vieram como arquivos no export.
- Vídeos são embeds de **tella.tv** e **YouTube** — mantidos como embed (não dá p/ self-host).
- `README.md` e `MEDIA.md` do export **não** viram páginas do site (são índice/inventário).

---

## 4. Regras de conversão de conteúdo

A maior parte do trabalho é converter sintaxes que **quebram no MDX** do Docusaurus.

### 4.1 GitBook → Docusaurus MDX (Central de Ajuda)

| GitBook (origem) | Docusaurus (destino) |
|---|---|
| `{% hint style="success" %}…{% endhint %}` | `:::tip` … `:::` |
| `{% hint style="info" %}` | `:::info` |
| `{% hint style="warning" %}` | `:::warning` |
| `{% hint style="danger" %}` | `:::danger` |
| `{% embed url="<URL>" %}` | `<VideoEmbed url="URL" />` |
| `<figure><img src="URL" alt=""><figcaption></figcaption></figure>` | `![](URL)` (markdown) |
| `<mark style="color:orange;">texto</mark>` | `texto` (remove o `<mark>`; em título vira texto puro) |
| `<a href="#x" id="x"></a>` | removido (âncora vazia) |
| `&#x20;` e entidades soltas | removido / espaço normal |
| `<img src="…">` sem fechar (HTML inválido em JSX) | `<img … />` ou convertido p/ markdown |
| `<div><figure>…</figure> <figure>…</figure></div>` | duas imagens markdown |

### 4.2 MkDocs/pymdownx → Docusaurus MDX (API)

| MkDocs (origem) | Docusaurus (destino) |
|---|---|
| `!!! note "Título"` | `:::note[Título]` |
| `??? ...` (colapsável) | `<details><summary>…</summary>…</details>` ou admonition |
| `=== "Aba"` (pymdownx.tabbed) | `<Tabs>` / `<TabItem>` (`@theme/Tabs`) |
| emoji `:material-…:` / `:rocket:` | emoji unicode direto |
| `![](assets/Pasted image ….png)` | `![](/img/api/<arquivo>.png)` (copiado p/ static) |
| Tabelas, code fences ```` ```json ```` | mantidos (compatíveis) |

> A doc de API começa por uma seção interna **"Regras da Meta"** + **"Ver Logs de Erro"** que
> têm webhooks/IDs sensíveis de suporte. Revisar se devem ser **publicados** ou ficar numa
> página marcada como interna (decisão na Fase 3).

---

## 5. Etapas detalhadas

### Fase 0 — Pré-requisitos ✅ (verificado)
- [x] Node v24.13, npm 11.8, git 2.53, gh 2.92 instalados.
- [x] `gh` autenticado como `gianpm` (escopos `repo`, `workflow`).
- [x] Diretório de trabalho `ihelp-doc` vazio.
- [ ] Confirmar que `gianpm` tem permissão de criar/empurrar no org `ihelpchat`.

### Fase 1 — Scaffold do Docusaurus
1. `npx create-docusaurus@latest . classic --typescript` (no diretório atual, que está vazio).
2. Remover conteúdo de exemplo (tutorial `docs/`, blog de exemplo, páginas demo).
3. Configurar `docusaurus.config.ts`:
   - `title`, `tagline`, `favicon`.
   - `url: 'https://ihelpchat.github.io'`, `baseUrl: '/ihelp-docs/'`.
   - `organizationName: 'ihelpchat'`, `projectName: 'ihelp-docs'`.
   - `i18n: { defaultLocale: 'pt-BR', locales: ['pt-BR'] }`.
   - Preset classic: docs (Ajuda) + blog (Novidades).
   - Segunda instância de docs via `@docusaurus/plugin-content-docs` (`id: 'api'`, `path: 'api'`, `routeBasePath: 'api'`, `sidebarPath: './sidebarsApi.ts'`).
   - Plugin de busca local `@easyops-cn/docusaurus-search-local` (`language: ['pt','en']`).
   - `navbar` (Ajuda, API, Novidades, GitHub) e `footer`.
   - `themeConfig` (prism, colorMode claro/escuro).
4. `src/css/custom.css` → paleta verde da marca iHelp.
5. `npm run start` para validar que sobe.

### Fase 2 — Migração da Central de Ajuda (FAQ)
1. Escrever `scripts/migrate-gitbook.mjs` aplicando as regras da seção 4.1.
2. Percorrer o export, gerar frontmatter (`title` do H1 / nome do arquivo; `sidebar_position` por ordem).
3. Mapear estrutura GitBook → `docs/` preservando hierarquia; gerar `_category_.json` por pasta (label + posição).
   - Arquivo `<secao>.md` que tem pasta irmã `<secao>/` vira `<secao>/index.md` (página índice da categoria).
4. Imagens: `scripts/download-images.mjs` baixa cada `faq.ihelpchat.com/files/<id>` para `static/img/help/<id>.<ext>` (detecta extensão pelo content-type) e reescreve os `src`. **Fallback:** se o download falhar, mantém o hotlink (URL remota) e loga o item.
5. Criar `src/components/VideoEmbed.tsx` (tella.tv `/view` → iframe embed; YouTube `watch?v=` → embed).
6. `npm run build` e revisar páginas que o MDX reclamar (HTML inválido residual).

### Fase 3 — Migração da Documentação de API
1. Escrever `scripts/migrate-api.mjs` que lê `ihelp-docs-api/docs/index.md` e **divide por H2** em uma página por seção:
   - `regras-da-meta.md`, `ver-logs-de-erro.md`, `autenticacao.md`, `obter-token.md`,
     `buscar-atendimento-por-telefone.md`, `buscar-metadados.md`, `resumir-conversa.md`,
     `buscar-chats-em-massa.md`, `buscar-historico-de-mensagens.md`, `transcrever-audio.md`,
     `pegar-ids-departamento-canal.md`, `mensagem-comum.md`, `mensagem-em-grupo.md`,
     `template-json-body.md`, `template-enviar-chat-existente.md`, `template-criar-novo-chat.md`.
   - (Agrupar por categorias na sidebar: *Conceitos*, *Atendimentos*, *Mensagens*, *Templates*, *Suporte/Logs*.)
2. Aplicar regras da seção 4.2 (admonitions, tabs, emoji).
3. Copiar `ihelp-docs-api/docs/assets/*.png` → `static/img/api/` e reescrever os caminhos.
4. **Decisão de conteúdo:** revisar "Regras da Meta" e "Ver Logs de Erro" (contêm IDs de webhook de suporte) — publicar ou marcar como interno.
5. Criar `sidebarsApi.ts` e o item "API" na navbar.
6. `npm run build`.

### Fase 4 — Blog (Novidades e Atualizações)
1. Dividir `novidades-e-atualizacoes.md` por cabeçalho `## … Atualização DD/MM/YYYY` em posts:
   - `blog/2026-04-24-nova-tela-de-senha.md`
   - `blog/2025-07-23-encerramento-automatico-e-filtros.md`
   - `blog/2025-06-30-listas-personalizadas.md`
   - `blog/2025-06-27-edicao-de-mensagens.md`
   - `blog/2025-06-10-citacoes-status-catalogo.md`
   - `blog/2025-05-25-calendario-agendamento-e-robo-ligacao.md`
   - Cada post: frontmatter `title`, `date`, `authors: [gian]`, `tags`, `slug`. Corpo convertido (regras 4.1).
2. Criar `blog/authors.yml` (autor `gian`) e `blog/tags.yml` (ex.: `atualizacao`, `whatsapp`, `atendimento`).
3. Config do blog: `blogTitle: 'Novidades'`, `blogSidebarTitle: 'Atualizações recentes'`, `postsPerPage`, RSS/Atom on, `feedOptions`.
4. Documentar no README **como postar** (ver seção 6).

### Fase 5 — Home, marca, busca e acabamento
1. Landing `src/pages/index.tsx`: hero + 3 cards (Ajuda / API / Novidades).
2. Logo + favicon (placeholder agora; trocar pela arte oficial depois) e cores verdes.
3. Configurar e testar a busca local.
4. Footer (links úteis: site iHelp, suporte, FAQ antigo enquanto migra), navbar, página 404.

### Fase 6 — Deploy (GitHub Pages) + push
1. Criar `.github/workflows/deploy.yml` (checkout → setup-node → `npm ci` → `npm run build` → `upload-pages-artifact` (`build/`) → `deploy-pages`).
2. Garantir repo: `gh repo create ihelpchat/ihelp-docs --public` se ainda não existir.
3. `git init` → `.gitignore` (node_modules, build, .docusaurus) → `git add -A` → commit.
4. `git remote add origin https://github.com/ihelpchat/ihelp-docs.git` → `git branch -M main` → `git push -u origin main`.
5. Nas configs do repo: **Settings → Pages → Source = GitHub Actions**.
6. Validar o deploy em `https://ihelpchat.github.io/ihelp-docs/`.

### Fase 7 — Verificação final + manutenção
1. `npm run build` (checar `onBrokenLinks: 'throw'`).
2. Varredura de links/âncoras quebrados e imagens que falharam no download.
3. README com: comandos de dev, como adicionar página de doc, **como postar no blog**, e **como plugar o Decap CMS depois**.
4. Lista de limpezas manuais pendentes (vídeos sem preview, imagens faltantes, "Regras da Meta" etc.).

---

## 6. Como "users" postam no blog (sem CMS, como combinado)

O site é **estático**: um post = **um arquivo `.md` na pasta `blog/`** no repositório. Não há
banco de dados nem servidor. Publicar = colocar o arquivo no GitHub → o GitHub Actions
reconstrói o site → post no ar.

**Quem pode postar:** qualquer pessoa com acesso de colaborador no repo `ihelpchat/ihelp-docs`.

**Forma A — pela interface do GitHub (sem instalar nada):**
1. No repo, abrir a pasta `blog/` → **Add file → Create new file**.
2. Nome `AAAA-MM-DD-titulo.md`. Colar o cabeçalho:
   ```markdown
   ---
   title: Título da novidade
   date: 2026-06-15
   authors: [gian]
   tags: [atualizacao]
   ---
   Texto da atualização...
   ```
3. **Commit** → em ~1–2 min o post aparece no site.

**Forma B — via Git (para quem usa terminal):** clonar, criar o `.md`, `git push` (ou abrir Pull Request para revisão antes de publicar).

**Futuro (documentado, fora do escopo agora) — Decap CMS:** um painel em `/admin` com
formulário visual, para equipe não-técnica. Como o GitHub Pages é estático, o login do GitHub
(OAuth) exige um pequeno **OAuth proxy** externo (ex.: Cloudflare Worker, ~30 linhas, grátis).
O site continua no GitHub Pages; só o login conversa com o proxy. Fica registrado no README
para ativar quando quiserem.

---

## 7. Riscos e pontos de atenção

| Risco | Mitigação |
|---|---|
| MDX é estrito: HTML inválido do GitBook quebra o build | Script de conversão + `npm run build` iterativo por arquivo |
| Imagens hotlinkadas do FAQ antigo podem sair do ar | Baixar localmente p/ `static/img/` (Fase 2.4) |
| Embeds de vídeo (tella.tv) sem API de embed pública | Componente `VideoEmbed` com iframe; revisar caso a caso |
| Conteúdo sensível na doc de API (webhooks/IDs de suporte) | Revisão na Fase 3.4 antes de publicar |
| `gianpm` precisa de permissão no org `ihelpchat` | Confirmar antes da Fase 6 |
| Pages de projeto exige `baseUrl` correto | `/ihelp-docs/` fixado na config |

---

## 8. Entregáveis

1. Site Docusaurus completo no repo `ihelpchat/ihelp-docs`, publicado em `https://ihelpchat.github.io/ihelp-docs/`.
2. Central de Ajuda migrada (~45 páginas).
3. Documentação de API migrada (estática, mantida no Docusaurus).
4. Blog "Novidades" com as atualizações existentes + fluxo de postagem documentado.
5. CI de deploy automático (push em `main` → publica).
6. README com guia de manutenção e instruções de postagem.

---

## 9. Ordem de execução sugerida

```
Fase 1 (scaffold) → Fase 6 parcial (repo + push inicial "esqueleto no ar")
   → Fase 2 (Ajuda) → Fase 3 (API) → Fase 4 (Blog)
   → Fase 5 (home/marca/busca) → Fase 7 (verificação)
```

> Subir o esqueleto cedo (Fase 1 → push) valida o deploy no GitHub Pages antes de
> investir na migração de conteúdo.
