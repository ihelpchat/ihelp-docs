# Padrão editorial da documentação iHelp

Cada página deve ajudar a pessoa a concluir uma tarefa ou tomar uma decisão sem precisar conhecer termos internos do produto.

## Tipos de conteúdo

- **FAQ:** responde uma dúvida específica. Começa pela resposta direta e aponta o procedimento completo quando existir.
- **Tutorial:** conduz uma tarefa do início ao resultado, com pré-requisitos, passos na ordem da interface e resultado esperado.
- **Guia:** explica um recurso, suas decisões e os caminhos relacionados.
- **Referência:** registra contratos técnicos, parâmetros, exemplos e erros de uma API.

## Estrutura mínima

1. Título orientado à intenção da pessoa.
2. Descrição específica, útil também nos resultados de busca.
3. Resposta ou objetivo nas primeiras linhas.
4. Headings descritivos e hierarquia contínua.
5. Passos numerados quando a ordem importar.
6. Imagens com texto alternativo e sem dados pessoais.
7. Alertas apenas para risco, permissão, custo ou consequência irreversível.
8. Links internos relativos e Tango somente quando houver workflow público verificado.

## Regras de qualidade

- Preservar fatos do produto; não completar lacunas por suposição.
- Usar o nome exibido na interface e informar a permissão necessária.
- Remover links legados, headings decorativos, repetições e chamadas genéricas para tutoriais.
- Manter links internos e arquivos de imagem ou vídeo resolvíveis pela auditoria automatizada.
- Informar limitações e o que enviar ao suporte quando o autoatendimento não resolver.
- Conteúdo enviado por IA entra como draft ou pull request e sempre passa por revisão humana.
