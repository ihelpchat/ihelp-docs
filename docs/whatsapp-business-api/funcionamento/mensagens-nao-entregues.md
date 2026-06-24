---
title: "Mensagens não entregues"
---

# ❓ FAQ — Por que minha mensagem não foi entregue mesmo estando tudo certo?

> **Contexto:** Esta situação ocorre na API Oficial do WhatsApp (Cloud API / WhatsApp Business Platform). O número está correto, o template foi aprovado, o envio foi realizado — mas a mensagem não chegou ao destinatário.

---

## O que significa "enviada" vs. "entregue"?

**Enviada (✓ um tick cinza):** A mensagem saiu dos servidores da Meta com sucesso.  
**Entregue (✓✓ dois ticks cinzas):** A mensagem chegou ao dispositivo do destinatário.  
**Lida (✓✓ dois ticks azuis):** O destinatário abriu a conversa.

⚠️ **A API pode confirmar o envio e ainda assim a mensagem nunca chegar.** Isso não é um erro da iHelp nem da GupShup — é um comportamento documentado e intencional da Meta.

---

## Por que a mensagem não foi entregue mesmo com tudo certo?

Existem três causas principais. A Meta **não informa qual delas ocorreu** em cada caso — isso é intencional, por razões de privacidade.

---

### 1. 🚫 O usuário bloqueou o número

Se o destinatário bloqueou o número da empresa (ou qualquer número vinculado ao mesmo Gerenciador de Negócios), o WhatsApp **simula que a mensagem foi enviada** — mas ela nunca chega.

Esse comportamento protege a privacidade de quem bloqueou, impedindo que a empresa saiba que foi bloqueada.

💡 **O que fazer:** Solicite ao cliente, por outro canal (e-mail, SMS, ligação), que verifique se o número está bloqueado em:  
**Configurações → Privacidade → Contatos bloqueados**

---

### 2. 📊 Limite global de mensagens de marketing (Frequency Capping)

O WhatsApp impõe um limite diário de quantas mensagens promocionais um usuário pode receber **no total, de todas as empresas combinadas** — não apenas da sua.

O limite documentado é de aproximadamente **2 templates de marketing por usuário por dia**, somando todos os remetentes. Se esse limite foi atingido antes do seu envio, sua mensagem é **retida ou descartada** — mesmo que o template esteja aprovado e o número esteja correto.

⚠️ **Isso está fora do controle da iHelp e da GupShup.** É uma política global da Meta. O código de erro associado é o **131049**.

💡 **Boas práticas para reduzir esse impacto:**
- Envie mensagens com alta relevância e personalização
- Ofereça opção de opt-out clara nos templates
- Evite disparos em alta frequência para a mesma base
- Aguarde pelo menos 24 horas antes de retentar um envio que falhou por esse motivo

---

### 2a. 🔇 O usuário não respondeu suas mensagens anteriores

Este é um mecanismo separado do limite global — e afeta especificamente a **relação entre o seu número e aquele contato**.

Se você enviou um template de marketing para um contato e ele **não respondeu**, a Meta pode impedir o envio de novos templates de marketing para esse mesmo contato. O raciocínio da Meta é: sem resposta = sem interesse = recuar.

⚠️ O prazo exato que a Meta usa para aplicar essa restrição **não é divulgado** — o critério é algorítmico e varia por contato.

💡 **O que isso significa na prática:**
- Se um contato nunca responde seus disparos de marketing, em algum momento ele deixa de receber novas mensagens suas dessa categoria
- Contatos que **respondem** continuam recebendo normalmente
- Dentro da **janela de 24h após uma resposta do usuário**, você pode enviar mensagens livres sem restrição de template

> **Resumo dos dois mecanismos:**
>
> | Mecanismo | Escopo | Gatilho |
> |---|---|---|
> | Frequency capping global | Usuário ↔ todas as empresas | Limite diário atingido por qualquer remetente |
> | Inatividade com seu número | Usuário ↔ seu número específico | Usuário não responde suas mensagens de marketing |

---

### 3. 📴 O usuário ficou offline por mais de 30 dias

A Meta armazena mensagens nos servidores por até **30 dias** enquanto aguarda o destinatário ficar online.

Se o usuário não acessou o WhatsApp nesse período, a mensagem é **descartada automaticamente pelos servidores da Meta**.

⚠️ Não há como reenviar retroativamente. A mensagem simplesmente deixa de existir nos servidores.

---

## Por que a Meta não informa o motivo real da falha?

Porque é intencional. A própria documentação oficial da Meta declara:

> *"For many of these reasons, we will not disclose the underlying cause of the error, because of privacy and policy reasons."*  
> *(Por muitos desses motivos, não divulgaremos a causa subjacente do erro, por razões de privacidade e política.)*  
> — [Documentação oficial Meta/WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/support)

---

## Outros motivos documentados pela Meta

Além dos três principais, a Meta lista situações em que a mensagem pode não ser entregue:

| Situação | O que acontece |
|---|---|
| Versão desatualizada do WhatsApp | A mensagem não é entregue. O usuário precisa atualizar o app. |
| País restrito ou sancionado | Números em Cuba, Irã, Coreia do Norte, Síria e regiões sancionadas da Ucrânia não recebem mensagens via API. |
| Usuário não aceitou os novos Termos de Uso | A Meta bloqueia a entrega até o aceite. |
| Usuário em grupo de experimento da Meta | Pode haver restrições temporárias de entrega. |

---

## O que eu posso fazer quando isso acontece?

**Passo 1:** Verifique se o número está correto e no formato internacional (+55...).  
**Passo 2:** Confirme que o template foi aprovado e está ativo.  
**Passo 3:** Solicite ao cliente, por outro canal, que:
- Confirme se consegue enviar uma mensagem para o seu número
- Verifique se o número está na lista de bloqueados
- Atualize o WhatsApp para a versão mais recente
- Confirme se aceitou os Termos de Uso mais recentes

💡 **Importante:** Esses passos devem ser feitos por outro meio de comunicação, já que o WhatsApp pode não estar funcionando para esse contato.

---

## A iHelp ou a GupShup conseguem descobrir o motivo da não entrega?

**Não.** A Meta não expõe essa informação nem para as plataformas (como iHelp), nem para os BSPs (como GupShup). É uma limitação estrutural da própria API Oficial do WhatsApp.

O que a plataforma retorna é apenas o status: `sent` (enviado) ou `failed` (falha com código de erro) — e nem sempre um código de erro é retornado.

---

## Isso significa que a API Oficial é menos confiável?

Não necessariamente. A API Oficial do WhatsApp tem **alta taxa de entrega** quando usada com boas práticas. Os casos acima representam situações específicas relacionadas ao comportamento do usuário final e às políticas de privacidade da Meta — não a falhas da plataforma.

💡 **Para maximizar entrega:**
- Mantenha sua base de contatos atualizada e com opt-in confirmado
- Use templates com alto índice de leitura e relevância
- Respeite a frequência de envio por contato
- Monitore a qualidade do número no Gerenciador do WhatsApp

---

*Referência oficial: [Meta WhatsApp Business Platform — Support & Troubleshooting](https://developers.facebook.com/documentation/business-messaging/whatsapp/support)*
