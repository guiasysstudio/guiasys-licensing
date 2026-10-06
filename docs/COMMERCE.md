# Comercio C14-A

## Modelo

- `customerAccounts/{accountId}`: conta global; `accountId = acct_ + SHA-256(firebaseUid)[0:20]`.
- `customerAccounts/{accountId}/projectCustomers/{projectId}`: vinculo idempotente com um unico customer por projeto.
- `customerAccounts/{accountId}/orders/{orderId}` e `/licenses/{licenseId}`: referencias de ownership e listagem escalavel.
- `orders/{orderId}`: snapshot da oferta, totais inteiros em centavos e estados separados.
- `projects/{projectId}/customers/{customerId}` e `/licenses/{licenseId}`: modelos de licenciamento preservados.

Planos novos ou alterados recebem `priceCents`. No primeiro pedido, planos legados sao convertidos de `price` por arredondamento decimal estrito e atualizados na mesma transacao; o navegador nunca envia preco, duracao ou limite de dispositivos.

## API do cliente

- `GET /api/v1/customer/me`
- `GET|POST /api/v1/customer/orders`
- `GET /api/v1/customer/orders/{orderId}`
- `POST /api/v1/customer/orders/{orderId}/payment` (somente PIX Sandbox)
- `POST /api/v1/customer/orders/{orderId}/cancel`
- `GET /api/v1/customer/licenses`
- `POST /api/v1/customer/licenses/{licenseId}/renewal-order`

Ownership sempre vem do ID token. IDs enviados sao validados contra referencias da conta. Um pedido aceita no maximo 10 linhas, 50 unidades por linha e 50 unidades totais.

## Fluxos e idempotencia

Criacao consulta projeto/plano publicados, cria snapshots e soma `unitPriceCents * quantity` em transacao. Nenhuma key nasce nesse fluxo. Cancelamento so e aceito antes do pagamento.

Renovacao valida ownership e cria item `renewal`, sem alterar a licenca. Apos confirmacao interna, `finalizePaidOrder()` chama `transitionLicense("renew")`, preservando a mesma key e as regras existentes.

Hashes de idempotency keys ficam em subcolecoes da conta. Tentativas, eventos e fulfillment tambem sao transacionais e idempotentes.

## Pagamento PIX Sandbox

O início do pagamento valida autenticação, ownership e estado do pedido. A rota fica fechada por padrão e exige simultaneamente `PAGBANK_SANDBOX_CHECKOUT_ENABLED=true` e o Firebase UID em `PAGBANK_SANDBOX_TESTER_UIDS` (lista separada por vírgulas). Uma tentativa `payments/{paymentId}` com `provider=pagbank`, `providerEnvironment=sandbox` e IDs externos inicialmente vazios é criada antes do acesso ao PagBank. O backend usa os snapshots do pedido e o cadastro persistido da conta para construir a cobrança; preço, descrição, produto e comprador enviados pelo navegador não são aceitos.

Depois do `POST /orders`, uma transação confere novamente pedido, conta, ambiente, valor, moeda e IDs antes de vincular a resposta normalizada ao payment e os vínculos mínimos ao order. O order não é marcado como pago e nenhum fulfillment ocorre nessa etapa.

Replays com a mesma chave não criam outro payment, e `order.activePaymentId` reserva atomicamente uma única tentativa ativa mesmo quando chaves diferentes chegam em concorrência. Cobranças já vinculadas são consultadas por `providerOrderId`; envios com resultado incerto ficam bloqueados para novo POST, pois a API Order não possui idempotência remota documentada no contrato consultado. Um administrador com `viewPayments` e `manageOrders`, autenticação recente e escopo no pedido pode reconciliar Sandbox em `POST /api/v1/admin/payments/{paymentId}/reconcile`, informando somente um `providerOrderId` (`ORDE_...`) confirmado operacionalmente. Produção permanece fail-closed enquanto `POST /orders` depender da whitelist. O evento `ORDER.CHARGE` segue pendente no protocolo PagBank `1457285324`, sem alteração nos endpoints ou na validação de assinatura dos webhooks.
