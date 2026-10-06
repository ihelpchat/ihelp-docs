# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Regra nº 1: toda mudança vai em `pilot/`

O site em produção é o app **Next.js 16 + Fumadocs** em `pilot/`. O Docusaurus na raiz do repo é **legado congelado**: não edite, não crie arquivo e não rode `npm` nele. O deploy (`.github/workflows/deploy.yml`) já builda só o `pilot/`, então qualquer edição no legado nunca chega ao ar.

Legado (somente leitura): `docs/`, `api/`, `blog/`, `tutoriais/`, `src/`, `static/`, `scripts/`, `docusaurus.config.ts`, `sidebars*.ts`, `package.json`/`package-lock.json` da raiz, `plan.md`, `LIMPEZAS-PENDENTES.md`, `README.md` da raiz, `build/`, `.docusaurus/`. Ele só continua no repo porque `pilot/scripts/migrate-content.mjs` (`npm run content:migrate`) lê dele para importar rotas que ainda faltam no `pilot`.

Onde cada coisa vive agora:

| Pedido | Legado (não mexer) | Novo (editar aqui) |
|---|---|---|
| Corrigir "Principais dúvidas" | `docs/principais-duvidas.md` | `pilot/content/docs/docs/principais-duvidas.mdx` |
| Página da API de Contatos | `api/...` | `pilot/content/docs/api/contatos/buscar-contatos.mdx` |
| Post de novidade | `blog/2026-06-15-x.md` | `pilot/content/docs/blog/<slug>.mdx` + `meta.json` |
| Imagem de ajuda | `static/img/help/x.png` | `pilot/public/img/help/x.png` |
| Vídeo | `static/videos/x.mp4` | `pilot/public/videos/x.mp4` |
| Componente MDX | `src/components/VideoEmbed.tsx` | `pilot/components/` + registro em `pilot/components/mdx.tsx` |

Se o pedido cita um arquivo que só existe no legado, porte o conteúdo para `pilot/content/docs/` (ou rode `content:migrate`) e edite lá.

## Comandos (rodar dentro de `pilot/`; o CI usa Node 22)

```bash
npm ci
npm run dev                # servidor de dev
npm run build              # export estático em out/
NEXT_PUBLIC_BASE_PATH=/ihelp-docs npm run build   # igual ao CI/GitHub Pages
npm start                  # serve out/
npm run content:validate   # architecture/coverage-matrix.json aponta só para páginas que existem
npm run content:audit      # padrão editorial em todos os .mdx (sai com 1 se algum falhar)
npm run mcp:test           # todos os testes do MCP/assistente
node mcp/real-state.test.mjs   # um teste só
npm run types:check && npm run lint
npm run qa:ui              # smoke com Playwright (precisa de build + npm start)
npm run qa:visual          # fidelidade ao protótipo do Claude Design
```

O CI de PR roda, nesta ordem: `content:validate` → `mcp:test` → `types:check` + `lint` → `build`. Rode o mesmo antes de dar a mudança por pronta. Teste novo em `mcp/*.test.mjs` só roda se for acrescentado à lista do script `mcp:test` no `pilot/package.json`.

## Arquitetura do `pilot/`

**Conteúdo:** uma única árvore Fumadocs em `content/docs/`, com quatro seções pela primeira pasta: `docs/` (Central de Ajuda), `tutoriais/`, `api/`, `blog/` (`sectionOf` em `lib/site.ts`). A rota é o caminho do arquivo: `content/docs/api/crm/cards/criar-card.mdx` → `/api/crm/cards/criar-card/`. Todas as páginas são renderizadas por `app/(docs)/[...slug]/page.tsx`.

**Frontmatter obrigatório** (schema em `lib/source.ts`; o build quebra se faltar):

```yaml
---
title: "Buscar contatos"
description: "Lista os contatos da empresa que batem com um trecho do nome ou do número."  # ≥ 20 caracteres
source: api            # produto | suporte | api
contentType: referencia # faq | tutorial | guia | referencia
method: GET            # só em referência de API
endpoint: /contacts    # só em referência de API
---
```

**Ordem e visibilidade no menu:** cada pasta tem um `meta.json` com `pages` explícito e nenhum usa `"..."`. Página nova que não for adicionada ao `pages` da pasta não aparece no menu. Ex.: criar `api/contatos/excluir-contato.mdx` exige adicionar `"excluir-contato"` em `api/contatos/meta.json`.

**Renomear ou mover página:** adicione o redirect em `pilot/vercel.json` (já há vários para `/ihelp-docs/api/crm/...`) e atualize `architecture/coverage-matrix.json` se a rota antiga estiver lá, senão `content:validate` falha com `Documento inexistente na matriz`.

**Componentes MDX** (`Callout`, `Params`/`Param`, `Fields`/`Field`, `CodeTabs`, `Response`, `StepCards`, `TutorialCard`, `VideoEmbed`, `ProductAction`, `Accordions`...) ficam disponíveis sem import via `components/mdx.tsx`. Callout usa `type="warn" | "info" | "idea" | "error"`, não a sintaxe `:::tip` do Docusaurus.

**Padrão editorial:** `architecture/editorial-standard.md` é obrigatório para FAQ, tutorial, guia e referência, e é o que `content:audit` e o MCP aplicam (`mcp/editorial-standard.mjs`).

**Build estático:** `next.config.mjs` usa `output: 'export'` e `trailingSlash: true`; não há servidor Next em produção. `NEXT_PUBLIC_BASE_PATH` define o prefixo (`/ihelp-docs` no Pages). Rotas para IA: `/llms.txt`, `/llms-full.txt` e `/llms.mdx/docs/<slug>/content.md`.

**Assistente + MCP (`mcp/`):** processo Node separado do site. `mcp/http.mjs` expõe `/mcp` (ferramentas `docs_*`, exige `Bearer DOCS_MCP_API_KEY`) e `/assistant` (busca os artigos localmente e chama a OpenAI Responses API com `store: false`). O site estático só conhece a URL via `NEXT_PUBLIC_ASSISTANT_URL`; sem ela, a UI mostra "Assistente não conectado". Contrato do assistente em `lib/assistant.ts`; detalhes em `mcp/README.md`. O MCP só cria draft (`.drafts/`) ou pull request, nunca faz merge nem deploy.

## Deploy

- Site: push em `main` → `.github/workflows/deploy.yml` builda `pilot/` com `NEXT_PUBLIC_BASE_PATH=/ihelp-docs` e publica `pilot/out` no GitHub Pages. `pilot/vercel.json` guarda os redirects e o `noindex` de `/acesso-mcp`.
- Assistente/MCP: Railway, imagem `pilot/Dockerfile.mcp`. A imagem copia `content/`, então o assistente só enxerga conteúdo novo depois de um redeploy do Railway.
