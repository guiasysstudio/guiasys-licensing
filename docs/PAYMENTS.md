# Pagamentos C14-A

`payments/{paymentId}` armazena valor em centavos, moeda, provedor, referencia externa, metodo e timestamps. `paymentEvents/{eventId}` armazena somente metadados normalizados; payload bruto, PAN, CVV, senha, token e dados bancarios nao sao persistidos.

Estados: `pending`, `processing`, `paid`, `failed`, `cancelled`, `refunded`. As transicoes sao validadas em `commerce-policy.js`. Tentativas e eventos possuem registros idempotentes.

O painel e somente leitura sob `viewPayments`. Nao existe endpoint publico ou administrativo que marque pagamento como pago. `finalizePaidOrder(orderId, paymentContext)` e interno, exige status pago, mesmo pedido/conta, BRL e valor exato, e executa emissao/renovacao junto ao marcador de fulfillment em uma transacao.

## C14-B

O C14-B devera fornecer Secret Manager, credenciais reais, cliente HTTP oficial, criacao/cancelamento de cobranca, PIX, cartao pelo fluxo oficial, assinatura de webhook e normalizacao de estados. O evento confirmado chamara o servico interno existente. Nenhum secret deve ser versionado.
