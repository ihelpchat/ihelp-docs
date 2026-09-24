# M4.15 — fontes e limites por intenção

O relatório fornecido (`ihelp-cs/suporte/relatorio.html` e `ANALISE.md`) mede **10/08 a 09/09/2026, 30 dias**. Não há nessa evidência um recorte de 180 dias; a ordem das nove intenções veio da tarefa ClickUp 86akpbgr4. O código do frontend foi consultado apenas para rotas e rótulos, sem alterações no `ihelp-react`.

| Ordem | Intenção | Fontes de produto já presentes | Limite aplicado ao guia |
| --- | --- | --- | --- |
| 1 | Cobrança/plano | Relatório de suporte e rota `/configuracoes` | Não há tela ou procedimento de faturamento documentado; não afirmar valor, limite ou vencimento. Escalar divergência. |
| 2 | Usuário/acesso | `sobre-o-sistema/configuracoes/gerenciamento-de-usuarios.mdx` | Perfil, departamento e permissões têm passos; edição de e-mail e limite de usuários exigem atendimento. |
| 3 | Reconectar canal/QR | `sobre-o-sistema/configuracoes/canais.mdx` | Conexão por QR documentada; causa da queda, QR rejeitado, recuperação de mensagens e remoção de dispositivos não comprovadas. |
| 4 | API Oficial/QR/coexistência | `whatsapp-business-api/o-basico/o-que-e-a-api-oficial-do-whatsapp.mdx`; `configuracoes/canais.mdx` | Comparação geral documentada; elegibilidade, migração do mesmo número, preço e efeitos da coexistência dependem de confirmação humana. |
| 5 | Campanhas | `sobre-o-sistema/campanhas/como-criar-uma-nova-campanha.mdx` | Fluxo e screenshots de preparação, configuração, revisão e acompanhamento; entrega individual depende do status exibido. |
| 6 | Permissões/departamentos | `configuracoes/departamentos/index.mdx`; `configuracoes/gerenciamento-de-usuarios.mdx` | Ajuste de equipe e permissões documentado; não prometer acesso a dados de outras equipes. |
| 7 | Templates | `whatsapp-business-api/funcionamento/o-que-sao-templates-e-para-que-servem.mdx` | Conceito, envio à Meta e aprovação documentados; estado real e falha de sincronização não verificáveis pela Claricia. |
| 8 | Arquivos | `sobre-o-sistema/atendimento.mdx`; relatório de suporte | A área de anexo está documentada e tem screenshot; falha de upload, abertura e entrega exigem diagnóstico humano. |
| 9 | CRM | `sobre-o-sistema/crm/como-criar-uma-nova-pipeline.mdx` | Criação de pipeline documentada; automação opcional precisa de teste próprio. |

Os ProductActions levam apenas a rotas fixas conferidas em `pagesData.tsx` do frontend. O widget público é um hint não autenticado; o guia e a fonte continuam disponíveis mesmo quando esse estado sugere erro, falta de permissão ou plano vencido. Não há vídeo automático nos novos guias.
