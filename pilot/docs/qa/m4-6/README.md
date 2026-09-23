# Footer mobile — rework M4.6

Captura local, sem dados de clientes, no viewport 390 × 844 com a home rolada até o fim. O launcher da Claricia permanece visível, e todos os links do footer ficam descobertos.

O teste `npm run qa:ui` usa `elementFromPoint` no centro do link **Suporte** para comprovar que o próprio link recebe o clique. Antes do ajuste, atingia `.ih-ai-launcher`; após o ajuste, atinge o `<a>`. O teste RED é `51abe8dfbf3ded8a1d7e9a568ff1ddd0952ede30`. O ajuste adiciona espaço inferior apenas no footer mobile.
