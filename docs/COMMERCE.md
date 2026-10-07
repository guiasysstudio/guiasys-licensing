# Comércio C14-C

## Modelo

- `customerAccounts/{accountId}`: conta global; `accountId = acct_ + SHA-256(firebaseUid)[0:20]`.
- `customerAccounts/{accountId}/projectCustomers/{projectId}`: vinculo idempotente com um unico customer por projeto.
- `customerAccounts/{accountId}/orders/{orderId}` e `/licenses/{licenseId}`: referencias de ownership e listagem escalavel.
- `orders/{orderId}`: snapshot da oferta, totais inteiros em centavos e estados separados.
- `counters/orders`: contador transacional para números amigáveis `GS-NNNNNN`, sem usar contagem de documentos.
- `platformSettings/payments`: configuração administrativa do provider e dos dados públicos do PIX.
- `projects/{projectId}/customers/{customerId}` e `/licenses/{licenseId}`: modelos de licenciamento preservados.

Planos novos ou alterados recebem `priceCents`. No primeiro pedido, planos legados sao convertidos de `price` por arredondamento decimal estrito e atualizados na mesma transacao; o navegador nunca envia preco, duracao ou limite de dispositivos.

## API do cliente

- `GET|PATCH /api/v1/customer/me`
- `POST|DELETE /api/v1/customer/me/photo`
- `POST /api/v1/customer/address/cep` (consulta autenticada; CEP fica no corpo, não no path/log)
- `GET|PUT /api/v1/customer/cart`
- `GET /api/v1/customer/favorites`
- `POST|DELETE /api/v1/customer/favorites/{projectId}`
- `GET|POST /api/v1/customer/orders`
- `GET /api/v1/customer/orders/{orderId}`
- `POST /api/v1/customer/orders/{orderId}/payment` (PIX manual operacional)
- `POST /api/v1/customer/orders/{orderId}/payment-reported`
- `POST /api/v1/customer/orders/{orderId}/cancel`
- `GET /api/v1/customer/licenses`
- `POST /api/v1/customer/licenses/{licenseId}/renewal-order`

Ownership sempre vem do ID token. IDs enviados sao validados contra referencias da conta. Um pedido aceita no maximo 10 linhas, 50 unidades por linha e 50 unidades totais.

## Fluxos e idempotencia

Criacao consulta projeto/plano publicados, cria snapshots e soma `unitPriceCents * quantity` em transacao. Nenhuma key nasce nesse fluxo. Cancelamento so e aceito antes do pagamento.

Renovacao valida ownership e cria item `renewal`, sem alterar a licenca. Apos confirmacao interna, `finalizePaidOrder()` chama `transitionLicense("renew")`, preservando a mesma key e as regras existentes.

Hashes de idempotency keys ficam em subcolecoes da conta. Tentativas, eventos e fulfillment tambem sao transacionais e idempotentes.

## Pagamento PIX manual

O pedido nasce em `pending_payment`, com snapshots de cliente, produto, plano, duração e preço, além de `paymentProvider=manual_pix`, `paymentMethod=pix` e TXID determinístico. O pagamento local contém o BR Code e o QR Code correspondente. Informar pagamento move pedido/pagamento para `payment_reported`/`reported`, sem marcar como pago e sem emitir licença.

O administrador confirma somente pedidos informados. A confirmação chama o mesmo `finalizePaidOrder()` já usado pelo comércio, valida pagamento, conta, valor e moeda novamente e cria ou renova a licença dentro da transação de fulfillment. O replay retorna o pedido já concluído e não duplica licença, renovação ou logs críticos.

As listas do cliente partem das referências em `customerAccounts/{accountId}` e nunca aceitam um UID no payload. Firestore e Storage permanecem `deny-all` para clientes; leituras e mutações passam pela Function autenticada.

## PagBank Sandbox — histórico congelado

Esta seção descreve a C14-B preservada. Na C14-C ela só pode ser exercitada em testes históricos quando `PAYMENT_PROVIDER=pagbank` e `PAGBANK_ENABLED=true` são definidos explicitamente. O runtime publicado usa os defaults opostos e não vincula tokens PagBank.

O início do pagamento valida autenticação, ownership e estado do pedido. A rota fica fechada por padrão e exige simultaneamente `PAGBANK_SANDBOX_CHECKOUT_ENABLED=true` e o Firebase UID em `PAGBANK_SANDBOX_TESTER_UIDS` (lista separada por vírgulas). Uma tentativa `payments/{paymentId}` com `provider=pagbank`, `providerEnvironment=sandbox` e IDs externos inicialmente vazios é criada antes do acesso ao PagBank. O backend usa os snapshots do pedido e o cadastro persistido da conta para construir a cobrança; preço, descrição, produto e comprador enviados pelo navegador não são aceitos.

Depois do `POST /orders`, uma transação confere novamente pedido, conta, ambiente, valor, moeda e IDs antes de vincular a resposta normalizada ao payment e os vínculos mínimos ao order. O order não é marcado como pago e nenhum fulfillment ocorre nessa etapa.

Replays com a mesma chave não criam outro payment, e `order.activePaymentId` reserva atomicamente uma única tentativa ativa mesmo quando chaves diferentes chegam em concorrência. Cobranças já vinculadas são consultadas por `providerOrderId`; envios com resultado incerto ficam bloqueados para novo POST, pois a API Order não possui idempotência remota documentada no contrato consultado. Um administrador com `viewPayments` e `manageOrders`, autenticação recente e escopo no pedido pode reconciliar Sandbox em `POST /api/v1/admin/payments/{paymentId}/reconcile`, informando somente um `providerOrderId` (`ORDE_...`) confirmado operacionalmente. Produção permanece fail-closed enquanto `POST /orders` depender da whitelist. O evento `ORDER.CHARGE` segue pendente no protocolo PagBank `1457285324`, sem alteração nos endpoints ou na validação de assinatura dos webhooks.


## Portal C15 — continuidade do checkout

O botão **Adicionar ao carrinho** incrementa a quantidade e mantém o usuário na página. **Comprar agora** apenas adiciona quando a oferta ainda não está no carrinho; se já estiver, abre o carrinho sem incrementar silenciosamente.

O navegador mantém um draft de checkout por conta + fingerprint do carrinho para reutilizar a mesma idempotency key e o mesmo pedido pendente após fechar/reabrir o PIX. Alterar o carrinho invalida esse draft. O backend continua sendo a autoridade de idempotência.

CPF, telefone e CEP recebem máscara no frontend e validação real no backend. A consulta de CEP é mediada pela Function e envia somente o CEP ao serviço de endereço. O PIX é exibido em modal responsivo; fechar o modal não apaga o pedido pendente.
