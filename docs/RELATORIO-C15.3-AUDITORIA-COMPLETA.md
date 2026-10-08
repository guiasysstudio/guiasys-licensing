# Relatório C15.3 — Auditoria completa e correções

**Projeto:** GuiaSys Licensing  
**Repositório:** `guiasysstudio/guiasys-licensing`  
**Baseline de produção auditado:** `9a042b771703ee527426ec5a54501f2155a8fcfa`  
**Branch de auditoria/correção:** `fix/c15-auditoria-completa`  
**Data:** 07/10/2026

## 1. Objetivo

Auditar diretamente o código do GuiaSys Licensing após a publicação da C15.2, confrontando a implementação com o comportamento esperado do portal público, painel administrativo, checkout PIX manual e motor de licenciamento. A auditoria também corrige defeitos encontrados, sem reativar PagBank, sem merge na `main` e sem deploy de produção.

## 2. Escopo revisado

A árvore do repositório foi inspecionada e os caminhos de produção foram revisados em profundidade:

- portal público: `public/index.html`, `public/assets/catalog.js`, `public/assets/catalog.css`, assets oficiais;
- painel administrativo: `index.html`, `assets/js/app.js`, `assets/css/app.css`, verificador de entitlement;
- backend: `worker/src/index.js`, validação, autenticação, segurança, rate limiting, transações, licenciamento, fulfillment, adapters Firebase e providers de pagamento;
- Firebase: `.firebaserc`, `firebase.json`, Firestore Rules, Storage Rules, indexes e Hosting multi-site;
- testes e CI: suítes Node, workflows de segurança/configuração e verificadores de build;
- documentação operacional e arquitetural.

## 3. Resultado executivo

A arquitetura central está saudável: preço e fulfillment permanecem server-side, Firestore/Storage são deny-all para clientes diretos, Auth/RBAC estão centralizados na Function, pedidos e pagamentos possuem transições controladas e fulfillment é idempotente. O PagBank continua congelado.

A auditoria encontrou defeitos reais principalmente na camada de UX/continuidade do checkout e alguns pontos de hardening. Eles foram corrigidos na branch de auditoria.

### Classificação

| Severidade | Situação | Resultado |
|---|---|---|
| Alta / confiabilidade | repetição do checkout podia criar pedidos pendentes adicionais no navegador | corrigido |
| Média / segurança | parâmetro `next` aceitava caminho `//host` e podia virar redirect externo | corrigido |
| Média / privacidade | CEP inicialmente seria enviado no path da API e poderia aparecer em logs | corrigido antes de produção |
| Média / funcional | “Comprar agora” incrementava silenciosamente item já existente | corrigido |
| Média / UX | PIX era renderizado inline, pequeno e inadequado | corrigido com modal responsivo |
| Média / UX | abertura do WhatsApp após `await` podia ser bloqueada pelo navegador | corrigido |
| Média / cadastro | CPF, telefone e CEP eram texto livre | corrigido |
| Média / cadastro | não existia busca/autopreenchimento por CEP | corrigido |
| Média / Auth | usuário de e-mail/senha podia ficar sem caminho fácil para reenviar confirmação | corrigido |
| Baixa / UX | catálogo com card excessivamente largo e texto incoerente | corrigido |
| Baixa / UX | fallback “Imagem comercial não cadastrada” expunha estado interno | corrigido |
| Baixa / UX | favoritos não refletiam estado persistido ao recarregar | corrigido |
| Baixa / Storage | troca de logo/ícone/banner deixava arquivo antigo órfão | corrigido |
| Baixa / consistência | versão estática do painel estava em 0.17.0 enquanto runtime era 0.18.0 | corrigido |
| Baixa / SEO | Open Graph não acompanhava rota/produto | corrigido |

## 4. Correções implementadas

### 4.1 Carrinho e “Comprar agora”

- **Adicionar ao carrinho** continua incrementando e mantendo o usuário na página.
- **Comprar agora** agora:
  - adiciona 1 unidade se a oferta ainda não estiver no carrinho;
  - se já existir, não incrementa silenciosamente;
  - navega para o carrinho.
- texto do carrinho alterado para: “Cada unidade comprada gera uma licença independente e uma key própria.”

### 4.2 Continuidade/idempotência do checkout

Foi criado um draft local de checkout por UID + fingerprint do carrinho:

- reutiliza a mesma idempotency key;
- guarda o `orderId` pendente;
- fechar o modal/recarregar não cria outro pedido para o mesmo carrinho;
- alterar quantidade/remover item invalida o draft;
- pedido já informado/pago/concluído não é recriado.

O backend continua sendo a autoridade final de idempotência.

### 4.3 Modal PIX

O PIX deixou de ser renderizado dentro do card lateral do carrinho.

Novo modal:

- QR Code em tamanho adequado;
- número do pedido;
- valor;
- chave PIX e identificação/TXID quando disponíveis;
- PIX Copia e Cola;
- botão de cópia;
- botão “Já efetuei o pagamento”;
- instrução de confirmação manual;
- fechamento por botão, backdrop e Esc;
- focus trap/restauração de foco;
- layout mobile em viewport completa;
- pedido permanece recuperável após fechar o modal.

### 4.4 WhatsApp

A janela do WhatsApp é aberta de forma compatível com a política de popup dos navegadores:

1. cria janela vazia durante o clique do usuário;
2. backend confirma `payment_reported`;
3. janela é direcionada ao `wa.me`;
4. em falha, a janela vazia é fechada.

A mensagem continua dependendo do envio manual pelo cliente.

### 4.5 Perfil: CPF, telefone e CEP

Implementado:

- máscara e teclado numérico para CPF;
- validação de dígitos verificadores no frontend e backend;
- máscara de telefone;
- máscara de CEP;
- UF limitada a duas letras maiúsculas;
- backend continua validando os campos independentemente da interface.

### 4.6 Busca de CEP

Criada rota autenticada:

`POST /api/v1/customer/address/cep`

Payload:

```json
{ "postalCode": "76900000" }
```

Características:

- CEP não é colocado no path/URL de request;
- rate limit;
- timeout;
- validação da resposta;
- somente endereço sanitizado retorna ao cliente;
- frontend consulta em blur/Tab ou Enter;
- preenche logradouro, bairro, cidade e UF;
- número/complemento continuam manuais;
- todos os campos continuam editáveis;
- campos de endereço antigos são limpos se a resposta não trouxer determinado valor.

### 4.7 Redirect pós-login

O parâmetro `next` agora aceita apenas caminho local seguro. Foram bloqueados:

- URL externa;
- path iniciado por `//`;
- backslash;
- controles inválidos;
- origem diferente.

### 4.8 E-mail/senha

No perfil, conta ainda não verificada agora oferece:

- **Reenviar confirmação**;
- **Já confirmei**, com reload do usuário e refresh do token.

O checkout continua bloqueado até `emailVerified=true`.

### 4.9 Favoritos

O estado persistido de favoritos agora é carregado no login e refletido no:

- catálogo;
- detalhe do programa;
- página de favoritos.

Troca de conta/logout limpa o estado local correspondente.

### 4.10 Catálogo e detalhe

- grid limitado a cards compactos em desktop;
- texto da listagem alterado para não mencionar planos;
- fallback comercial de mídia agora usa monograma/nome do programa;
- espaçamento de página individual reduzido quando há pouco conteúdo.

### 4.11 Storage comercial

Ao substituir logo, ícone ou banner:

1. novo objeto é gravado;
2. metadata Firestore é salva;
3. objeto anterior é removido somente depois da persistência bem-sucedida.

Isso evita apagar o asset atual antes de uma gravação válida.

### 4.12 Metadados e painel

- `og:title` e `og:description` acompanham a rota;
- versão estática do painel alinhada para `v0.18.0`.

## 5. Segurança confirmada

### Firestore / Storage

As Rules permanecem fail-closed:

```
allow read, write: if false;
```

Navegador não possui acesso direto ao banco/Storage da aplicação. Operações passam pela Function.

### Autenticação

- Firebase ID Token;
- verificação de revogação;
- verificação do estado real da conta;
- RBAC administrativo;
- autenticação recente em ações sensíveis.

### Comércio

- preço calculado no servidor;
- snapshot imutável do pedido;
- UID/ownership derivados da sessão;
- cliente não pode marcar pedido como pago;
- cliente não pode emitir key;
- confirmação administrativa valida valor/moeda/pedido;
- multi-quantity gera keys independentes;
- fulfillment idempotente.

### PagBank

Permanece congelado:

- provider operacional: `manual_pix`;
- `PAGBANK_ENABLED=false`;
- token PagBank não necessário;
- código histórico preservado para futura atualização.

## 6. Firebase / Hosting

Confirmado:

- projeto: `guiasys-licensing`;
- runtime Functions v2 / Node.js 22;
- região: `southamerica-east1`;
- target público e target Admin separados;
- builds de Hosting com allowlists;
- CSP, HSTS, X-Frame-Options, nosniff, Referrer/Permissions Policy;
- rewrites para `licensingApi`;
- deep links públicos via fallback para `index.html`.

## 7. Testes e CI

No último commit funcional validado da auditoria:

- **197/197 testes Node aprovados**;
- **0 falhas**;
- `npm audit --omit=dev --audit-level=moderate`: **0 vulnerabilidades encontradas**;
- sintaxe backend: aprovada;
- sintaxe frontend público/Admin: aprovada;
- Firebase Config Check: aprovado;
- build Hosting Admin: **8 arquivos permitidos**;
- build Hosting público: **8 arquivos permitidos**;
- compilação Firestore/Storage Rules em emulador: aprovada;
- teste de concorrência/retry transacional do Firestore: aprovado.

Os commits posteriores ao último gate funcional alteraram apenas documentação.

## 8. Pontos não bloqueantes restantes

### 8.1 Screenshots comerciais órfãos — resolvido na correção C15 Storage

A edição da lista agora mantém URLs e `screenshotStoragePaths` alinhados, persiste primeiro
o estado correto e remove depois somente objetos que deixaram de ser referenciados. URLs
externas informadas no CMS são fontes de importação e não são mais persistidas como mídia
definitiva.

### 8.2 Lockfile do backend

O diretório `worker/` não mantém `package-lock.json`; CI usa `npm install`.

**Risco:** reprodutibilidade de dependências transitivas.  
**Recomendação:** gerar e versionar lockfile de forma controlada em uma etapa dedicada e migrar CI/predeploy para `npm ci`. Não foi criado lockfile artificial nesta auditoria.

### 8.3 GitHub Actions por tags

Actions de terceiros usam tags de versão, não SHAs imutáveis.

**Risco:** hardening de supply chain, baixo no contexto atual.  
**Recomendação futura:** pin por commit SHA.

### 8.4 Termos e Privacidade

As páginas funcionam tecnicamente e a privacidade passou a informar a consulta de CEP, mas o conteúdo jurídico continua conciso.

**Recomendação:** revisão jurídica antes de escala comercial.

## 9. Testes humanos ainda necessários após futuro deploy

Esta branch **não foi implantada em produção**.

Após aprovação e deploy controlado, repetir:

1. desktop/tablet/mobile;
2. login Google;
3. cadastro e-mail/senha + verificação/recuperação;
4. CPF/telefone/CEP e autopreenchimento;
5. adicionar ao carrinho;
6. Comprar agora com item já existente;
7. fechar/reabrir modal PIX sem duplicar pedido;
8. PIX real de baixo valor;
9. WhatsApp + comprovante;
10. confirmação no Admin;
11. fulfillment;
12. key em Minhas compras;
13. ativação e revalidação da key real no GuiaPlay.

## 10. Estado de entrega

- Nenhum merge na `main`.
- Nenhuma release.
- Nenhum deploy desta branch.
- Produção continua no baseline anterior até autorização explícita.
- Correções disponíveis somente em `fix/c15-auditoria-completa`.

