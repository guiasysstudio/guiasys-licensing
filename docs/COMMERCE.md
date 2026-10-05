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
- `POST /api/v1/customer/orders/{orderId}/cancel`
- `GET /api/v1/customer/licenses`
- `POST /api/v1/customer/licenses/{licenseId}/renewal-order`

Ownership sempre vem do ID token. IDs enviados sao validados contra referencias da conta. Um pedido aceita no maximo 10 linhas, 50 unidades por linha e 50 unidades totais.

## Fluxos e idempotencia

Criacao consulta projeto/plano publicados, cria snapshots e soma `unitPriceCents * quantity` em transacao. Nenhuma key nasce nesse fluxo. Cancelamento so e aceito antes do pagamento.

Renovacao valida ownership e cria item `renewal`, sem alterar a licenca. Apos confirmacao interna, `finalizePaidOrder()` chama `transitionLicense("renew")`, preservando a mesma key e as regras existentes.

Hashes de idempotency keys ficam em subcolecoes da conta. Tentativas, eventos e fulfillment tambem sao transacionais e idempotentes.
