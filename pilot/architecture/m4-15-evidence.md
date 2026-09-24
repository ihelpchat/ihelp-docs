# M4.15 — fontes e limites por intenção

O relatório fornecido (`ihelp-cs/suporte/relatorio.html` e `ANALISE.md`) mede **10/08 a 09/09/2026, 30 dias**. Não há nessa evidência um recorte de 180 dias; a ordem das nove intenções veio da tarefa ClickUp 86akpbgr4. O código do frontend foi consultado apenas para rotas e rótulos, sem alterações no `ihelp-react`.

| Ordem | Intenção / guia | Fonte de produto versionada | Captura comprovada | Limite aplicado |
| --- | --- | --- | --- | --- |
| 1 | Cobrança/plano `cobranca-plano` | Relatório de suporte; nenhuma página de cobrança no frontend consultado | Sem captura comprovada | `/configuracoes` abre Canais. Sem deep link de cobrança: exceção explícita ao requisito geral de ProductAction. Resposta parcial e atendimento, sem valor, limite ou vencimento inventado. |
| 2 | Usuário/acesso `usuario-acesso` | `sobre-o-sistema/configuracoes/gerenciamento-de-usuarios.mdx` | Sem captura comprovada | Perfil, departamento e permissões têm passos; edição de e-mail e limite de usuários exigem atendimento. |
| 3 | Reconectar canal/QR `reconectar-canal-qr` | `sobre-o-sistema/configuracoes/canais.mdx` | Sem captura comprovada | Conexão por QR documentada; causa da queda, QR rejeitado, recuperação de mensagens e remoção de dispositivos não comprovadas. |
| 4 | API Oficial/QR/coexistência `api-oficial-qr-coexistencia` | `whatsapp-business-api/o-basico/o-que-e-a-api-oficial-do-whatsapp.mdx`; `configuracoes/canais.mdx` | Sem captura comprovada | Elegibilidade, migração do mesmo número, preço e efeitos da coexistência dependem de confirmação humana. |
| 5 | Campanhas `campanhas` | `sobre-o-sistema/campanhas/como-criar-uma-nova-campanha.mdx` | `/img/help/hlPVE1pICUAOU19G5Kgc.png` (nova campanha) e `/img/help/zwMQTwWLf6wi5Q9aeTWN.png` (planilha), ambas na fonte original e em `public/` | O card não comprova entrega individual; consultar o status. |
| 6 | Permissões/departamentos `permissoes-departamentos` | `configuracoes/departamentos/index.mdx`; `configuracoes/gerenciamento-de-usuarios.mdx` | Sem captura comprovada | Ajuste de equipe e permissões documentado; não prometer acesso a dados de outras equipes. |
| 7 | Templates `templates` | `whatsapp-business-api/funcionamento/o-que-sao-templates-e-para-que-servem.mdx` | Sem captura comprovada | Estado real e falha de sincronização não verificáveis pela Claricia. |
| 8 | Arquivos `arquivos` | `sobre-o-sistema/atendimento.mdx` | `/img/help/GfhFEXvIay0CqgN2dth6.png` (área de anexos), na fonte original e em `public/` | Falha de upload, abertura e entrega exigem diagnóstico humano. |
| 9 | CRM `crm` | `sobre-o-sistema/crm/como-criar-uma-nova-pipeline.mdx` | Sem captura comprovada; o Tango da fonte não é imagem estática versionada | Trava, estágios e automação opcional seguem a fonte; testar automação separadamente. |

O inventário considerou as imagens referenciadas nas fontes acima e os arquivos em `pilot/public/img/help`. Capturas de outros módulos não provam estas sete telas, por isso ficaram sem imagem. Os demais ProductActions levam apenas a rotas fixas conferidas em `pagesData.tsx` do frontend. O widget público é um hint não autenticado; não suprime guia, fonte, imagem comprovada nem ação autorizada. Não há vídeo automático nos novos guias.
