# Documentação iHelp

Site único de documentação do **iHelp**, feito com [Docusaurus 3](https://docusaurus.io), reunindo:

- **Central de Ajuda** (`/docs`) — FAQ em pt-BR para o usuário final.
- **Documentação de API** (`/api`) — referência para desenvolvedores.
- **Novidades** (`/blog`) — atualizações de produto.

Publicado via **GitHub Pages** em `https://ihelpchat.github.io/ihelp-docs/`.

---

## Desenvolvimento local

```bash
npm install        # instala dependências
npm run start      # servidor de dev em http://localhost:3000/ihelp-docs/
npm run build      # build de produção (gera build/)
npm run serve      # serve o build localmente
```

Requisitos: Node.js ≥ 20.

---

## Estrutura

```
docs/      → Central de Ajuda (Markdown/MDX). Sidebar autogerada pela estrutura de pastas.
api/       → Documentação de API. Sidebar autogerada; categorias em _category_.json.
blog/      → Novidades (um arquivo .md por post).
src/       → Componentes (VideoEmbed), tema (cores), landing page.
static/    → Arquivos estáticos servidos como estão:
  static/videos/  → 15 vídeos .mp4 self-hosted (tutoriais do FAQ).
  static/img/     → imagens da Ajuda (help/) e da API (api/).
scripts/   → Scripts de migração (GitBook/MkDocs → Docusaurus) — referência histórica.
```

---

## Como adicionar / editar conteúdo

### Página da Central de Ajuda
1. Crie um `.md` em `docs/<categoria>/`.
2. Frontmatter mínimo:
   ```markdown
   ---
   title: Título da página
   ---
   ```
3. Para ordenar, use `sidebar_position` no frontmatter ou ajuste o `_category_.json` da pasta.

### Vídeo numa página
Os vídeos ficam em `static/videos/`. Para embutir um player:
```mdx
<VideoEmbed url="/videos/arquivo.mp4" />
```
O componente `VideoEmbed` também aceita links do **YouTube** e **tella.tv** (vira iframe).

### Imagem
Coloque o arquivo em `static/img/help/` e referencie com caminho absoluto:
```markdown
![descrição](/img/help/arquivo.png)
```

---

## Como postar no Blog (Novidades)

O site é **estático**: um post = **um arquivo `.md` na pasta `blog/`**. Publicar = colocar o
arquivo no GitHub → o GitHub Actions reconstrói o site → post no ar (~1–2 min).

**Forma A — pela interface do GitHub (sem instalar nada):**
1. No repo, abra a pasta `blog/` → **Add file → Create new file**.
2. Nome: `AAAA-MM-DD-titulo.md`. Conteúdo:
   ```markdown
   ---
   title: Título da novidade
   date: 2026-06-15
   authors: [gian]
   tags: [atualizacao]
   ---
   Primeiro parágrafo (aparece como resumo na lista).

   {/* truncate */}

   Resto do conteúdo...
   ```
3. **Commit** → em ~1–2 min o post aparece no site.

**Forma B — via Git:** clone, crie o `.md`, `git push` (ou abra um Pull Request para revisão).

> Autores ficam em `blog/authors.yml`; tags em `blog/tags.yml`.

---

## Deploy

O deploy é automático: todo `push` na branch `main` dispara o workflow
`.github/workflows/deploy.yml` (build + publicação no GitHub Pages).

Para ativar (uma vez): **Settings → Pages → Source = GitHub Actions**.

> **Atenção:** GitHub Pages em repositório **privado** exige plano pago da organização.
> Em conta gratuita, o repositório precisa ser **público** para o Pages funcionar.

---

## Futuro: Decap CMS (fora do escopo agora)

Para permitir que a equipe não-técnica poste pelo navegador com um formulário visual,
é possível plugar o [Decap CMS](https://decapcms.org) em `/admin`. Como o GitHub Pages é
estático, o login via GitHub (OAuth) exige um pequeno **OAuth proxy** externo (ex.: um
Cloudflare Worker gratuito, ~30 linhas). O site continua no Pages; só o login conversa com
o proxy. Fica registrado aqui para ativar quando quiserem.

---

## Pendências

Veja **[LIMPEZAS-PENDENTES.md](./LIMPEZAS-PENDENTES.md)** para a lista de itens manuais
(imagens do FAQ antigo a recapturar, logo/favicon oficiais, etc.).
