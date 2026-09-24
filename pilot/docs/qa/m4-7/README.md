# QA M4.7 — documentação Claricia

Código verificado: pilot `b6b0f272ebe9a90ceaab771c3fcc5bcd5bf78b0e`, mais o ajuste do smoke `99e98b765a443b8f7111ef7f85da044366e4ff8e`. O teste do primeiro chip na home sem IA esperava uma pergunta antiga; o conteúdo atual e o ramo com IA já usam “Como reconectar meu WhatsApp?”. O ajuste conserva a asserção do preenchimento da busca.

Executado no build estático local, com Chrome headless, sem dados de cliente:

- `npm run build` e `npm run qa:ui` com `NEXT_PUBLIC_ASSISTANT_URL=http://127.0.0.1:3100/assistant`: passaram. O smoke intercepta `/assistant` com fixture e cobre resposta parcial, CTA/fonte, erro, navegação por teclado, FAQ, Tango, painel, links do footer e mobile.
- `npm run qa:visual` no mesmo build: passou. Desktop 1440×1000: 96,0% de pontos, 92,9% de grade de cor; mobile 390×844: 95,7% e 97,0%. O detalhamento está em [visual-summary.json](visual-summary.json).
- `npm run build` e `npm run qa:ui` sem `NEXT_PUBLIC_ASSISTANT_URL`: passaram, incluindo o fallback de busca da home e o hit test do link Suporte no footer mobile.
- `npm run mcp:test`: passou em inventário, busca, validação, draft, bloqueio de path e contexto do assistente.

Capturas: [home desktop](home-desktop.png), [home mobile](home-mobile.png), [painel desktop](painel-desktop.png), [painel mobile](painel-mobile.png), [onboarding desktop](onboarding-desktop.png), [onboarding mobile](onboarding-mobile.png) e [footer mobile](footer-mobile.png). São telas locais de conteúdo público/fixture, sem PII. O footer mobile mostra o link Suporte descoberto após M4.6; o smoke comprova o hit, que a imagem isolada não demonstra.

As capturas e o smoke não verificam serviço de IA remoto, instalação MCP em máquinas de colegas, ambiente autenticado do iHelp nem publicação em `faq.ihelpchat.com`. Nenhum deploy foi feito.
