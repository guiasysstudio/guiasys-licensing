# Pagamentos C14-A

`payments/{paymentId}` armazena valor em centavos, moeda, provedor, referencia externa, metodo e timestamps. `paymentEvents/{eventId}` armazena somente metadados normalizados; payload bruto, PAN, CVV, senha, token e dados bancarios nao sao persistidos.

Estados: `pending`, `processing`, `paid`, `failed`, `cancelled`, `refunded`. As transicoes sao validadas em `commerce-policy.js`. Tentativas e eventos possuem registros idempotentes.

O painel e somente leitura sob `viewPayments`. Nao existe endpoint publico ou administrativo que marque pagamento como pago. `finalizePaidOrder(orderId, paymentContext)` e interno, exige status pago, mesmo pedido/conta, BRL e valor exato, e executa emissao/renovacao junto ao marcador de fulfillment em uma transacao.

## C14-B

O C14-B integra o PagBank real sem versionar credenciais.

### C14-B.14 — fundacao do adapter e webhook

- `PAGBANK_TOKEN` e `PAGBANK_SANDBOX_TOKEN` ficam no Secret Manager e sao vinculados explicitamente a Function.
- Producao usa somente `https://api.pagseguro.com`; Sandbox usa somente `https://sandbox.api.pagseguro.com`. Nao existe fallback automatico entre ambientes.
- O adapter consulta a chave publica `webhook`, mantem cache em memoria e valida `x-payload-signature` sobre os bytes originais com ECDSA + SHA-256 antes de interpretar o JSON.
- O endpoint de producao e `POST /api/v1/webhooks/pagbank`.
- O endpoint `POST /api/v1/webhooks/pagbank/sandbox` existe exclusivamente para homologacao: mesmo com assinatura valida, nao grava pagamentos, nao altera pedidos e nunca chama fulfillment.
- Em producao, eventos so podem afetar um pagamento local `pagbank` previamente criado com `providerEnvironment=production`, mesma referencia, mesmo pedido PagBank, mesma cobranca, valor e moeda.
- Eventos persistem apenas metadados normalizados; corpo bruto, token, PAN, CVV e dados do pagador nao sao persistidos.
- Somente um evento normalizado como `paid` pode chegar a `finalizePaidOrder()`, que continua responsavel pela emissao/renovacao idempotente da key.

A criacao da cobranca de checkout, `notification_urls`, PIX/cartao na UI e comprovante PDF entram nas etapas seguintes do C14-B. O token de producao permanece configurado, mas a conta ainda depende da liberacao da whitelist do PagBank para `POST /orders`.
