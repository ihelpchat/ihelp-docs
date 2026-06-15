# Limpezas / pendências manuais

Itens que ficaram em aberto após a migração automática. Nenhum impede o site de funcionar.

## 1. Imagens do FAQ antigo — RESOLVIDO ✅

As imagens/screenshots da Central de Ajuda apontavam para `https://faq.ihelpchat.com/files/<id>`
(URLs mortas, HTTP 404) e o export do GitBook **não** trouxe os arquivos. **Foram recuperadas
do site GitBook ao vivo**: cada página renderizada serve as imagens pelo proxy do GitBook, com
URLs assinadas válidas. O script `scripts/harvest-faq-images.mjs` baixou as **76 imagens**
(68 na Central de Ajuda + 8 nas Novidades) para `static/img/help/` e a migração foi reexecutada
para reinserir as referências nas posições corretas (casadas por ordem com o `MEDIA.md`).

- Mapa id → arquivo local: `scripts/faq-image-map.json`.
- Relatórios: `scripts/harvest-report.txt`, `scripts/migration-report-faq.txt` (todas como
  `IMG RECUPERADA`), `scripts/migration-report-blog.txt`.
- Todas as 76 contagens por página bateram exatamente com o catálogo `MEDIA.md` do export.

> Os **15 vídeos** de tutorial também estão self-hospedados em `static/videos/`. Não há GIFs
> no acervo — todas as mídias de imagem do FAQ eram PNG.

## 2. Logo e favicon oficiais — RESOLVIDO ✅

Arte oficial do iHelp aplicada:

- **Navbar**: wordmark oficial (`static/img/logo.svg`) com variante de texto branco para o
  modo escuro (`static/img/logo-dark.svg`). O texto "iHelp Docs" foi removido (o wordmark já
  traz a marca).
- **Favicon**: gerado a partir do ícone oficial (`scripts/gen-favicon.mjs`, via `sharp`):
  `favicon.ico` multi-resolução (16/32/48/64), `favicon.png` (256) e `apple-touch-icon.png`
  (180). Tags no `<head>`: `.ico` (compatibilidade), ícone SVG nítido (`logo-icon.svg`) e
  apple-touch-icon (iOS).

> Falta só o **social/OG card** (`themeConfig.image` aponta para `img/ihelp-social-card.jpg`,
> que ainda não existe — a prévia ao compartilhar links fica sem imagem). É uma arte
> 1200×630 separada; não é favicon nem logo.

## 3. Âncoras legadas quebradas (2) — prioridade baixa

Dois links internos herdados do site antigo apontam para âncoras que não existem mais
(o navegador apenas abre o topo da página):

- `docs/principais-duvidas.md` → `.../acessando-a-plataforma#id-2o-passo-alterando-a-senha`
- `docs/sobre-o-sistema/atendimento.md` → `/docs#listas-personalizadas`
  (o conteúdo "Listas personalizadas" virou um post do blog: `/blog/listas-personalizadas`)

`onBrokenAnchors` está em `warn` por causa disso. Corrigir apontando para o destino certo.

## 4. Vídeos tella.tv sem versão local (2 páginas) — informativo

Duas páginas mantêm embed de **tella.tv** (renderizado via iframe) porque não havia `.mp4`
local correspondente:

- `docs/primeiros-passos/acessando-a-plataforma.md`
- `docs/sobre-o-sistema/campanhas/campanhas-na-api-oficial.md`

Se forem disponibilizados os arquivos, é só trocar por `<VideoEmbed url="/videos/...mp4" />`.

## 5. Conteúdo sensível da API — decisão tomada

As seções **"Regras da Meta"** e **"Ver Logs de Erro"** do `index.md` da API **NÃO foram
publicadas**: continham URLs de webhook com tokens e notas internas de suporte. Ficam de fora
do site público. Se precisarem ser consultadas internamente, seguem no repo `ihelp-docs-api`.

## 6. GitHub Pages: repositório privado — ação necessária para publicar

O repositório `ihelpchat/ihelp-docs` está **privado**. GitHub Pages em repo privado exige
plano pago da organização. Em conta gratuita, **tornar o repo público** para o site no ar.
O conteúdo já está versionado no Git de qualquer forma.
