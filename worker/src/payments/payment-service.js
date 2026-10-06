import { assertCents, transitionPaymentStatus } from "../commerce-policy.js";

function conflict(message, reason) {
  throw Object.assign(new Error(message), { status: 409, reason });
}

export async function createPaymentAttempt({ atomicClient, orderId, accountId, provider, idempotencyKey, hash, randomId, now }) {
  const keyHash = await hash(`${accountId}|${idempotencyKey}`);
  return await atomicClient.runTransaction(async tx => {
    const requestPath = `paymentRequests/${keyHash}`;
    const replay = await tx.get(requestPath);
    if (replay) {
      if (replay.orderId !== orderId || replay.accountId !== accountId) conflict("Chave de idempotência usada por outro pagamento.", "idempotency_conflict");
      const payment = await tx.get(`payments/${replay.paymentId}`);
      if (!payment) conflict("Registro idempotente de pagamento inconsistente.", "idempotency_orphan");
      return { payment, idempotentReplay: true };
    }
    const order = await tx.get(`orders/${orderId}`);
    if (!order || order.accountId !== accountId) conflict("Pedido não encontrado.", "order_not_found");
    if (!["pending_payment", "payment_failed"].includes(order.status)) conflict("Pedido não aceita nova tentativa de pagamento.", "payment_not_allowed");
    const paymentId = randomId("pay");
    const timestamp = now();
    const payment = {
      paymentId, orderId, accountId, provider, providerPaymentId: "", status: "pending",
      amountCents: assertCents(order.totalCents), currency: order.currency,
      method: "unknown", createdAt: timestamp, updatedAt: timestamp,
      paidAt: null, failedAt: null, cancelledAt: null
    };
    tx.create(`payments/${paymentId}`, payment);
    tx.create(requestPath, { paymentId, orderId, accountId, createdAt: timestamp });
    return { payment, idempotentReplay: false };
  });
}

export async function recordPaymentEvent({ atomicClient, normalizedEvent, hash, now }) {
  const provider = String(normalizedEvent.provider || "");
  const providerEventId = String(normalizedEvent.providerEventId || "");
  if (!provider || !providerEventId) conflict("Evento de pagamento sem identidade.", "invalid_payment_event");
  const eventId = `pevt_${(await hash(`${provider}|${providerEventId}`)).slice(0, 20)}`;
  return await atomicClient.runTransaction(async tx => {
    const existing = await tx.get(`paymentEvents/${eventId}`);
    if (existing) return { event: existing, idempotentReplay: true };
    const payment = await tx.get(`payments/${normalizedEvent.paymentId}`);
    if (!payment || payment.orderId !== normalizedEvent.orderId) conflict("Pagamento do evento não encontrado.", "payment_not_found");
    transitionPaymentStatus(payment.status, normalizedEvent.status);
    const timestamp = now();
    const nextPayment = {
      ...payment,
      status: normalizedEvent.status,
      updatedAt: timestamp,
      providerEnvironment: String(normalizedEvent.environment || payment.providerEnvironment || ""),
      providerOrderId: String(normalizedEvent.providerOrderId || payment.providerOrderId || ""),
      providerChargeId: String(normalizedEvent.providerChargeId || payment.providerChargeId || ""),
      providerPaymentId: String(normalizedEvent.providerChargeId || payment.providerPaymentId || ""),
      method: String(normalizedEvent.method || payment.method || "unknown")
    };
    if (normalizedEvent.status === "paid") nextPayment.paidAt = normalizedEvent.occurredAt || timestamp;
    if (normalizedEvent.status === "failed") nextPayment.failedAt = normalizedEvent.occurredAt || timestamp;
    if (normalizedEvent.status === "cancelled") nextPayment.cancelledAt = normalizedEvent.occurredAt || timestamp;
    tx.set(`payments/${payment.paymentId || normalizedEvent.paymentId}`, nextPayment);
    const event = {
      eventId,
      provider,
      providerEventId,
      orderId: normalizedEvent.orderId,
      paymentId: normalizedEvent.paymentId,
      providerEnvironment: String(normalizedEvent.environment || ""),
      providerOrderId: String(normalizedEvent.providerOrderId || ""),
      providerChargeId: String(normalizedEvent.providerChargeId || ""),
      providerStatus: String(normalizedEvent.providerStatus || ""),
      eventType: String(normalizedEvent.eventType || normalizedEvent.status),
      receivedAt: timestamp,
      processedAt: timestamp,
      processingStatus: "processed"
    };
    tx.create(`paymentEvents/${eventId}`, event);
    return { event, payment: nextPayment, idempotentReplay: false };
  });
}
