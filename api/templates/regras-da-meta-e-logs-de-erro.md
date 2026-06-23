---
title: "Regras da Meta e logs de erro"
sidebar_position: 5
---

## ⚠️ Regras da Meta

> *Regras não-documentadas*

| 🚫 Restrição | 📝 Descrição |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `❌ \n em params` | Não pode enviar quebras de linha dentro de variáveis de templates |
| `❌ Link em params` | Links devem ser enviados **apenas** em parâmetros de **URL Button** (templates com botões) |

**Erro:**

```json
message:400 - "{\"mensagem\":\"Object reference not set to an instance of an object.\"}"
```

**Causa:** Ocorre quando você tenta enviar um formato errado de body JSON, ou template ID que não existe/não foi criado naquele canal (ex: tentar enviar um template do canal A com o canal B).

---

## 🔍 Ver Logs de Erro

Para verificar por que o envio de templates está falhando, deve **adicionar nosso webhook logger no painel Gupshup e ativar todos os eventos**:

### 1. Adicionar Webhook Logger
```
https://webhook.ihelpchat.com/webhook/gup-logger-1mZ8DtHm0PDnLfNy6zltnLz3jQlvT5mz
```
> ✅ Adicione na aba **WEBHOOK** no painel Gupshup e tente enviar templates para verificarmos erros/avisos.
>
> 🚩 Não é necessário pedir pro usuário remover o link depois, podemos apenas rolar o id da url quando encerrarmos o suporte e então iremos parar de receber logs dos usuários que cadastraram o webhook antigo.

### 1.1 Solicite análise dos logs

É possível usar os endpoints abaixo para verificar as respostas da Meta às suas requisições, mas recomendamos solicitar que nosso time de suporte e desenvolvimento lhe ajude a analisar os logs.

### 2. Raw: Puxar Logs por App Name + Limite

O `appName` é o seu 'nome de app' no painel Meta ou Gupshup.
```
https://webhook.ihelpchat.com/webhook/7bb9bd3e-0ae5-4040-8a1e-1140909ad29e/get-logs/<appName>/<limit>
```
**Exemplo:**
```
https://webhook.ihelpchat.com/webhook/7bb9bd3e-0ae5-4040-8a1e-1140909ad29e/get-logs/SuporteiHelp/1000
```

### 3. Count Total de Logs por App Name
```
https://webhook.ihelpchat.com/webhook/7bb9bd3e-0ae5-4040-8a1e-1140909ad29e/count-logs/<appName>
```
