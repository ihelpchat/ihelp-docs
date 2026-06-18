---
title: "JSON Body pronto"
sidebar_position: 1
---

A forma mais fácil de pegar o request pronto para enviar - Crie um 'Novo Atendimento' pela interface do ihelp:

- **Podemos enviar todos os tipos de template:** 
     - Template de texto simples
     - Template de texto com parâmetros (variáveis de texto)
     - Template de texto com botão / botões
- Requests já incluirão o Departamento escolhido e o Canal

Para pegar o request pronto:
1. Abra o menu de desenvolvedor apertando **F12**
2. Clique na aba **Network**
3. Siga os passos abaixo: 

![](/img/api/explorer_ejWZE4Y5hl.png)
1. **Iniciar novo atendimento** com a aba Network aberta
2. Clicar no request **POST add-new-call**
3. Copiar o body JSON na aba **Request**
