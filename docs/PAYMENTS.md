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

### C14-B.15 — criação PIX no Sandbox

- O cliente autenticado inicia o pagamento por `POST /api/v1/customer/orders/{orderId}/payment`, enviando somente `method=pix` e uma `idempotencyKey`. O ambiente não é aceito no payload e permanece fixo em `sandbox` no backend. A rota é fail-closed: requer `PAGBANK_SANDBOX_CHECKOUT_ENABLED=true` e o Firebase UID presente em `PAGBANK_SANDBOX_TESTER_UIDS`; os defaults são desabilitado e lista vazia.
- O fluxo é `order local -> payment local -> POST /orders PagBank`. O `paymentId` é persistido antes da chamada externa; `order.reference_id` recebe o `orderId` e `charges[0].reference_id` recebe o `paymentId`.
- Valor, moeda, itens e comprador são montados exclusivamente a partir do pedido e da conta persistidos. Nome, e-mail verificado e CPF/CNPJ com dígitos verificadores válidos são obrigatórios; cadastro incompleto falha de forma controlada antes de chamar o PagBank. Esta etapa não cria uma rota de autoatendimento para alterar CPF/CNPJ: o dado precisa estar previamente provisionado na conta.
- A resposta do PagBank é normalizada e vinculada em transação. `providerOrderId` guarda somente `ORDE_...`; `providerChargeId` guarda somente `CHAR_...`; `providerPaymentId` permanece apenas como alias legado do Charge ID. Persistem também status, método, código PIX, ID/expiração do QR Code, URL HTTPS restrita ao host do ambiente e `paid_at` fornecido pelo PagBank. A resposta bruta e credenciais não são armazenadas.
- A mesma chave reutiliza a tentativa local. `order.activePaymentId` é reservado na mesma transação que cria a tentativa e impede uma segunda tentativa ativa com chave diferente. O lock só é liberado em falha definitiva ou estado terminal reconciliado. Se a tentativa já possui `providerOrderId`, o backend consulta `GET /orders/{id}` e reconcilia a mesma cobrança, sem repetir `POST /orders`.
- A documentação atual da API Order não declara suporte a `x-idempotency-key`; por isso esse header não é enviado. Antes do POST, a tentativa passa a `submitting`. Rejeições HTTP `400/401/403/404/405/415/422` com JSON e código de erro sanitizável são definitivas; sem essa evidência são conservadoramente incertas. Timeout, transporte, `408/425/429`, `5xx`, JSON inválido ou sucesso sem vínculo local deixam `submissionState=unknown` e preservam o lock para evitar cobrança duplicada.
- Tentativas `unknown`, `submitting` ou `linked` podem ser reconciliadas por administrador em `POST /api/v1/admin/payments/{paymentId}/reconcile`. A operação exige `viewPayments`, `manageOrders`, autenticação recente, escopo no pedido e ambiente Sandbox. O corpo aceita somente `providerOrderId=ORDE_...`; o status nunca é informado manualmente. Sem um `ORDE_` confirmado, a tentativa continua bloqueada para investigação operacional e não existe retry automático. Abandono manual permanece pendente e só poderá ser definido com evidência e revisão operacional.
- `WAITING`, `AUTHORIZED` e `IN_ANALYSIS` mantêm processamento; `PAID` registra o instante remoto sem emitir licença; `DECLINED`, `CANCELED`/`CANCELLED` e `REFUNDED` sincronizam payment/order e liberam o lock quando terminal. Status futuros desconhecidos são registrados como status do provedor, sem promover nem regredir o estado local.
- A criação está habilitada somente no Sandbox. Produção continua sem rota de criação e bloqueada pela whitelist do PagBank.
- `notification_urls` não é enviado. A pendência de `ORDER.CHARGE` continua acompanhada no protocolo PagBank `1457285324`.
- Criar ou reconciliar a cobrança não chama `finalizePaidOrder()` e não emite nem renova licença. O webhook Sandbox continua isolado; fulfillment depende do fluxo seguro de confirmação em produção.
