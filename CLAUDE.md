# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # install dependencies (Node.js ≥ 20 required)
npm run start      # dev server at http://localhost:3000/ihelp-docs/
npm run build      # production build → build/
npm run serve      # serve the production build locally
```

There are no tests. Build (`npm run build`) is the main correctness check — it throws on broken links and broken Markdown links.

## Architecture

This is a **Docusaurus 3** static site with three content sections, each a separate plugin instance:

| Section | Source folder | URL path | Config |
|---|---|---|---|
| Central de Ajuda (user FAQ) | `docs/` | `/docs` | preset-classic `docs` |
| API reference | `api/` | `/api` | `@docusaurus/plugin-content-docs` (id: `api`) |
| Novidades (blog) | `blog/` | `/blog` | preset-classic `blog` |

Sidebars are **auto-generated** from folder structure. `_category_.json` files control category labels and ordering. Use `sidebar_position` frontmatter to order individual pages.

**Search** is offline/client-side via `@easyops-cn/docusaurus-search-local` — no external search service.

**`VideoEmbed` component** (`src/components/VideoEmbed.tsx`) is globally available in all `.md`/`.mdx` files without import (registered in `src/theme/MDXComponents.tsx`). It handles:
- Local `.mp4` files in `static/videos/` → HTML5 `<video>`
- YouTube URLs → `youtube-nocookie.com` iframe
- `tella.tv` URLs → iframe
- Anything else → plain link fallback

## Content conventions

**Frontmatter minimum** for any page:
```markdown
---
title: Page Title
---
```

**Embedding a local video:**
```mdx
<VideoEmbed url="/videos/filename.mp4" />
```

**Embedding an image** (store in `static/img/help/`):
```markdown
![description](/img/help/filename.png)
```

**Blog post filename format:** `YYYY-MM-DD-slug.md`. Must include `{/* truncate */}` to split summary from full content. Authors defined in `blog/authors.yml`; tags in `blog/tags.yml`.

## Deployment

Every push to `main` triggers `.github/workflows/deploy.yml` → builds with `npm ci && npm run build` → publishes to GitHub Pages at `https://ihelpchat.github.io/ihelp-docs/`.

**Note:** GitHub Pages on a **private** repo requires a paid org plan. The repo must be public for free Pages to work.

## Known issues (LIMPEZAS-PENDENTES.md)

- `onBrokenAnchors: 'warn'` (not `throw`) — 2 legacy anchors remain broken:
  - `docs/principais-duvidas.md` → `acessando-a-plataforma#id-2o-passo-alterando-a-senha`
  - `docs/sobre-o-sistema/atendimento.md` → `/docs#listas-personalizadas`
- 2 pages embed `tella.tv` videos because no local `.mp4` exists for them.
- API sections "Regras da Meta" and "Ver Logs de Erro" were intentionally excluded (contained internal tokens/webhooks).
